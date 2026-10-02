# AFTER HOURS

*You fell asleep in detention. The school is locked for the night. Something is walking the halls.*

A top-down, co-op horror game for your local network. 1–8 players wake up in a pitch-black
school and must find the fuses, restore the power, and get out the front doors before
**The Hall Monitor** collects them.

No installs, no accounts, no assets to download: one computer runs a tiny Node.js server and
everyone else just opens a browser.

## Quick start

You need [Node.js](https://nodejs.org) 18 or newer on the computer that hosts.

```bash
cd after-hours
node server.js          # or: npm start   (Windows: double-click start.bat)
```

The server prints something like:

```
  On this computer:   http://localhost:3000
  Friends on your network open:
      http://192.168.1.23:3000
```

1. Open the first address on the host computer.
2. Friends on the **same Wi-Fi / LAN** open the second address in Chrome, Edge or Firefox.
3. Everyone picks a name. The first player in is the host (★): pick a difficulty and press **Lock the doors**.

Use a different port with `PORT=4000 node server.js`.

## How to survive

- **Find the fuses** scattered across the school (more players → more fuses) and bring them to the
  **fuse box in the Boiler Room**. Anyone can carry and insert them.
- When the last fuse goes in, the power comes back, the sirens start, the **front doors unlock**
  — and the Hall Monitor goes into a frenzy. Run for the green EXIT.
- **It hears running.** Sprinting, slamming doors and splashing through puddles bring it to you.
  Walking makes a little noise up close; crouching (`C`) is silent.
- **It sees light.** Your flashlight lets it spot you from far away, and shining the beam
  straight at it is a very bad idea. Turn it off (`F`) when it's close.
- **Hide** in hallway lockers and classroom closets (`E`). If it stops right outside, **hold your
  breath** (`Space`) — but not for too long. If it *sees* you climb in, it will pull you out.
- **Alarm clocks** (`G`) can be thrown to lure it somewhere else.
- **Caught?** You collapse and can crawl. A teammate can hold `E` on you to revive you. Get
  caught again (or bleed out) and you're **taken** — you can still spectate the others.
- Doors block sight. Close them behind you; it has to stop to open them.

Watch the eye at the top of the screen: it opens as the Hall Monitor notices you.

## Controls

| Key | Action |
| --- | --- |
| `WASD` / arrows | move |
| Mouse | aim flashlight |
| `Shift` | run (loud!) |
| `C` | toggle crouch (silent, harder to see) |
| `F` | flashlight on/off |
| `E` | open/close doors · hide · revive (hold) · insert fuses |
| `Space` | hold your breath while hiding · switch player while spectating |
| `G` | throw an alarm clock at the cursor |
| `Q` | energy drink (10 s of unlimited sprint) |
| `M` / `Tab` | map of the places you've seen |
| `Enter` | chat |
| `H` | show/hide the controls card |

## Difficulty

| | Monsters | Speed | Catches before you're taken | Wakes up after |
| --- | --- | --- | --- | --- |
| Easy | 1 | slower | 3 | 40 s |
| Normal | 1 (2 with 5+ players) | normal | 2 | 25 s |
| Nightmare | 2 (3 with 5+ players) | faster | 1 | 12 s |

Every round generates a new school layout.

## Tips for a scary night

- Headphones. Everything is positional: you can hear its footsteps clicking through the walls,
  and the heartbeat speeds up as it gets closer.
- Turn the room lights off.
- Split up to find fuses faster… if you dare.

## Troubleshooting

- **Friends can't connect:** make sure everyone is on the same network, and allow Node.js through
  the host's firewall (Windows asks the first time; choose *Private networks*). Guest/hotel Wi-Fi
  often blocks devices from seeing each other.
- **No sound:** browsers only start audio after you click; the *Enter the school* button does that.
  The PA announcements use your browser's built-in speech voices if it has any.
- **It's too dark:** turn your screen brightness up — that's part of the fun.

## How it's built

Zero dependencies — just Node's standard library and the browser.

```
after-hours/
  server.js            HTTP static server + lobby, runs the 20 Hz game loop
  server/ws.js         minimal WebSocket implementation (RFC 6455)
  server/mapgen.js     procedural school: hallways, rooms, furniture, lockers, items
  server/game.js       authoritative simulation and the Hall Monitor's AI
  server/pathfind.js   A* for the monster
  shared/              constants and ray-casting shared by server and client
  public/js/render.js  canvas renderer: ray-cast flashlights, darkness mask, jumpscare
  public/js/audio.js   every sound is synthesized live with WebAudio
  public/js/main.js    lobby, networking, movement, HUD
```

The monster hunts by sight (vision cone, range boosted by your flashlight) and sound (noise
events from running, doors, puddles, alarm clocks and gasps), investigates, searches, chases and
grabs hiders it saw. When nobody has been chased for a while it drifts toward the players.
