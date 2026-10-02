// Shared between the Node server and the browser client.

export const T = { VOID: 0, WALL: 1, HALL: 2, ROOM: 3, DOOR: 4, EXIT: 5 };

export const F = {
  NONE: 0, DESK: 1, TDESK: 2, SHELF: 3, TABLE: 4, BENCH: 5, BLEACH: 6, STALL: 7, SINK: 8,
  BOILER: 9, PIPE: 10, VEND: 11, CABINET: 12, PIANO: 13, CHAIR: 14, PAPERS: 15, BACKPACK: 16,
  PUDDLE: 17, BOOKS: 18, COUNTER: 19, MAT: 20, TRASH: 21, PLANT: 22, TROPHY: 23, COT: 24,
  EASEL: 25, DEBRIS: 26, BUCKET: 27, SEAT: 28,
};

// [blocks movement, blocks sight]
const FDEF = {
  [F.DESK]: [1, 0], [F.TDESK]: [1, 0], [F.SHELF]: [1, 1], [F.TABLE]: [1, 0], [F.BENCH]: [1, 0],
  [F.BLEACH]: [1, 0], [F.STALL]: [1, 1], [F.SINK]: [1, 0], [F.BOILER]: [1, 1], [F.PIPE]: [1, 0],
  [F.VEND]: [1, 1], [F.CABINET]: [1, 1], [F.PIANO]: [1, 0], [F.COUNTER]: [1, 0], [F.TRASH]: [1, 0],
  [F.PLANT]: [1, 0], [F.TROPHY]: [1, 1], [F.COT]: [1, 0], [F.EASEL]: [1, 0], [F.DEBRIS]: [1, 1],
  [F.BUCKET]: [1, 0], [F.SEAT]: [1, 0],
};
export const FSOLID = new Uint8Array(32);
export const FOPAQUE = new Uint8Array(32);
for (const k in FDEF) {
  FSOLID[k] = FDEF[k][0];
  FOPAQUE[k] = FDEF[k][1];
}

export const PLAYER = {
  walk: 3.0, sprint: 5.0, crouch: 1.6, crawl: 0.65, radius: 0.28,
  stamina: 4.0, breath: 6.0, batteryDrain: 0.75, batteryPack: 45,
};

export const DIFFICULTY = {
  easy: { label: 'Easy', monsters: [1, 1], speed: 0.86, dormant: 40, extraBatteries: 4, hearing: 0.8, downs: 2 },
  normal: { label: 'Normal', monsters: [1, 2], speed: 1.0, dormant: 25, extraBatteries: 2, hearing: 1.0, downs: 1 },
  nightmare: { label: 'Nightmare', monsters: [2, 3], speed: 1.1, dormant: 12, extraBatteries: 0, hearing: 1.25, downs: 0 },
};

export const COLORS = ['#d9a52b', '#c0392b', '#2e86c1', '#27ae60', '#8e44ad', '#e67e22', '#16a085', '#d35480'];

export const ITEM_NAMES = { fuse: 'Fuse', battery: 'Battery', clock: 'Alarm Clock', drink: 'Energy Drink' };

export const PA = {
  start: 'Good evening. You have fallen asleep in detention. The doors are locked until morning. Please... do not leave the room.',
  awake: 'The hall monitor is now on duty.',
  power: 'Power restored. All students, please proceed to the front exit. Quickly.',
  taken: 'Thank you for your cooperation.',
  random: [
    'Reminder. There is no running in the halls.',
    'The hall monitor is on duty. Please have your hall pass ready.',
    'Students found outside of class will be... collected.',
    'Detention has been extended. Indefinitely.',
    'Please keep your voices down. It can hear you.',
    'Lost and found has some new items.',
    'Lights out means lights out.',
    'Would the student hiding in the locker please... hold still.',
    'Tomorrow\'s lunch is... cancelled.',
  ],
};

export const GRAFFITI = [
  'DON\'T RUN', 'STAY QUIET', 'IT HEARS YOU', 'HIDE', 'LIGHTS OFF', 'NO HALL PASS',
  'HOLD YOUR BREATH', 'IT SEES LIGHT', 'NOT ALONE', 'TURN BACK',
];

export const BOARD_TEXT = [
  '2x + 4 = 10', 'HOMEWORK: CH. 13', 'NO TALKING', 'E = mc²', 'QUIZ FRIDAY',
  'STAY QUIET', 'DON\'T LEAVE', 'PAGE 66', 'THE BELL DOES NOT DISMISS YOU',
];

export const LOCKER_COLORS = ['#3c5a7a', '#7a3434', '#3e6b4a', '#6b6440', '#4a4a5a'];
