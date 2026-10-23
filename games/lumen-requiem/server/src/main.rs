//! Serveur de Lumen Requiem :
//! - HTTP statique (dossier `web/`) sur le port 8080 ;
//! - relais WebSocket lockstep sur le port 9001.
//!
//! Le relais ne simule rien : il attribue un numéro de joueur par salon,
//! diffuse le signal de départ (graine commune) puis relaie les entrées.
//! Chaque client exécute la même simulation déterministe.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread;

use tungstenite::{accept, Message};

const MAX_PLAYERS: usize = 3;

#[derive(Default)]
struct Room {
    peers: Vec<Option<Sender<String>>>,
    started: bool,
}

type Rooms = Arc<Mutex<HashMap<String, Room>>>;

/// Extraction minimale d'un champ JSON (`"clé":valeur`), suffisante pour ce protocole.
fn field<'a>(json: &'a str, key: &str) -> Option<&'a str> {
    let pat = format!("\"{}\":", key);
    let i = json.find(&pat)? + pat.len();
    let rest = json[i..].trim_start();
    if let Some(r) = rest.strip_prefix('"') {
        r.find('"').map(|e| &r[..e])
    } else {
        let e = rest.find([',', '}']).unwrap_or(rest.len());
        Some(rest[..e].trim())
    }
}

fn broadcast(room: &Room, msg: &str) {
    for p in room.peers.iter().flatten() {
        let _ = p.send(msg.to_string());
    }
}

fn count(room: &Room) -> usize {
    room.peers.iter().filter(|p| p.is_some()).count()
}

fn handle_ws(stream: TcpStream, rooms: Rooms) {
    let Ok(mut ws) = accept(stream) else { return };
    let _ = ws.get_ref().set_nonblocking(false);
    let (tx, rx) = channel::<String>();
    let mut me: Option<(String, usize)> = None;
    let _ = ws.get_mut().set_read_timeout(Some(std::time::Duration::from_millis(5)));
    loop {
        // Messages à envoyer à ce client.
        while let Ok(m) = rx.try_recv() {
            if ws.send(Message::text(m)).is_err() {
                break;
            }
        }
        match ws.read() {
            Ok(Message::Text(t)) => {
                let t = t.to_string();
                let kind = field(&t, "t").unwrap_or("");
                let mut rooms_g = rooms.lock().unwrap();
                match kind {
                    "join" if me.is_none() => {
                        let name: String = field(&t, "room").unwrap_or("halcyon").chars().filter(|c| c.is_alphanumeric() || *c == '-').take(24).collect();
                        let room = rooms_g.entry(name.clone()).or_default();
                        if room.started {
                            let _ = tx.send("{\"t\":\"full\"}".into());
                            continue;
                        }
                        let slot = room.peers.iter().position(|p| p.is_none()).unwrap_or(room.peers.len());
                        if slot >= MAX_PLAYERS {
                            let _ = tx.send("{\"t\":\"full\"}".into());
                            continue;
                        }
                        if slot == room.peers.len() {
                            room.peers.push(Some(tx.clone()));
                        } else {
                            room.peers[slot] = Some(tx.clone());
                        }
                        let n = count(room);
                        let _ = tx.send(format!("{{\"t\":\"welcome\",\"slot\":{},\"peers\":{}}}", slot, n));
                        broadcast(room, &format!("{{\"t\":\"peers\",\"peers\":{}}}", n));
                        println!("salon {name} : joueur {} connecté ({n})", slot + 1);
                        me = Some((name, slot));
                    }
                    "start" => {
                        if let Some((name, 0)) = &me {
                            if let Some(room) = rooms_g.get_mut(name) {
                                room.started = true;
                                let seed: u64 = field(&t, "seed").and_then(|s| s.parse().ok()).unwrap_or(1);
                                let players = room.peers.len().min(MAX_PLAYERS);
                                broadcast(room, &format!("{{\"t\":\"start\",\"seed\":{},\"players\":{}}}", seed, players));
                            }
                        }
                    }
                    "in" | "hash" => {
                        if let Some((name, slot)) = &me {
                            if let Some(room) = rooms_g.get(name) {
                                let f = field(&t, "f").unwrap_or("0");
                                let h = field(&t, "h").unwrap_or("0");
                                let msg = if kind == "in" {
                                    let c = field(&t, "c").unwrap_or("0");
                                    format!("{{\"t\":\"in\",\"s\":{},\"f\":{},\"h\":{},\"c\":{}}}", slot, f, h, c)
                                } else {
                                    format!("{{\"t\":\"hash\",\"s\":{},\"f\":{},\"h\":{}}}", slot, f, h)
                                };
                                for (i, p) in room.peers.iter().enumerate() {
                                    if i != *slot {
                                        if let Some(p) = p {
                                            let _ = p.send(msg.clone());
                                        }
                                    }
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
            Ok(Message::Close(_)) => break,
            Ok(_) => {}
            Err(tungstenite::Error::Io(e)) if e.kind() == std::io::ErrorKind::WouldBlock || e.kind() == std::io::ErrorKind::TimedOut => {}
            Err(_) => break,
        }
    }
    if let Some((name, slot)) = me {
        let mut rooms_g = rooms.lock().unwrap();
        if let Some(room) = rooms_g.get_mut(&name) {
            if let Some(p) = room.peers.get_mut(slot) {
                *p = None;
            }
            broadcast(room, &format!("{{\"t\":\"left\",\"s\":{}}}", slot));
            if count(room) == 0 {
                rooms_g.remove(&name);
            }
        }
        println!("salon {name} : joueur {} parti", slot + 1);
    }
}

fn serve_http(mut s: TcpStream, root: &str) {
    let mut buf = [0u8; 4096];
    let n = s.read(&mut buf).unwrap_or(0);
    let req = String::from_utf8_lossy(&buf[..n]);
    let path = req.split_whitespace().nth(1).unwrap_or("/");
    let path = path.split('?').next().unwrap_or("/");
    let path = if path == "/" { "/index.html" } else { path };
    if path.contains("..") {
        let _ = s.write_all(b"HTTP/1.1 400 Bad Request\r\n\r\n");
        return;
    }
    let file = format!("{}{}", root, path);
    match std::fs::read(&file) {
        Ok(body) => {
            let ct = match file.rsplit('.').next() {
                Some("html") => "text/html; charset=utf-8",
                Some("js") => "text/javascript; charset=utf-8",
                Some("css") => "text/css; charset=utf-8",
                Some("wasm") => "application/wasm",
                _ => "application/octet-stream",
            };
            let head = format!("HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: no-cache\r\n\r\n", ct, body.len());
            let _ = s.write_all(head.as_bytes());
            let _ = s.write_all(&body);
        }
        Err(_) => {
            let _ = s.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
        }
    }
}

fn main() {
    let root = std::env::args().nth(1).unwrap_or_else(|| concat!(env!("CARGO_MANIFEST_DIR"), "/../web").to_string());
    let http = TcpListener::bind("0.0.0.0:8080").expect("port 8080 occupé");
    let wsl = TcpListener::bind("0.0.0.0:9001").expect("port 9001 occupé");
    println!("Lumen Requiem : http://localhost:8080  ·  relais ws://localhost:9001  ·  fichiers : {root}");
    let rooms: Rooms = Arc::new(Mutex::new(HashMap::new()));
    thread::spawn(move || {
        for s in wsl.incoming().flatten() {
            let r = rooms.clone();
            let _ = s.set_nodelay(true);
            thread::spawn(move || handle_ws(s, r));
        }
    });
    for s in http.incoming().flatten() {
        let root = root.clone();
        thread::spawn(move || serve_http(s, &root));
    }
}
