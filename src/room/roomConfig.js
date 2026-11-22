// Everything the baked WorkPlace room needs to know about the exported files.
// The Blender export script writes public/models/room/manifest.json; this file
// only holds the things a person decides by hand (links, labels, credits).

export const ROOM_BASE = "./models/room/";

// Things you can click in the room. Their boxes come from the Blender export
// (manifest.hotspots); this holds what happens and what the card says.
// view: direction (three.js space) the camera looks at the object from.
export const HOTSPOTS = {
  G9: {
    groups: ["Desk", "Speakers"],
    label: "KeroCam",
    title: "KeroCam",
    body: "My own game-highlight recorder. It clips the best moments of a match automatically, no OBS needed.",
    link: { text: "Open KeroCam", url: "https://kerocam.jkeroro.com" },
    view: [-1, 0.3, 0.15],
  },
  Vert: {
    groups: ["Desk", "PC", "Speakers"],
    label: "GitHub",
    title: "GitHub",
    body: "Where everything I build lives: KeroCam, Lock, jkeroro.com and this room.",
    link: { text: "Open my GitHub", url: "https://github.com/Jkeroromk" },
    view: [-1, 0.2, 0.35],
    shift: 0.12,
  },
  MacBook: { groups: ["Desk"], label: "Enter my website", action: "macbook", view: [-1, 0.25, 0.1], distance: 0.55 },
  PC: {
    groups: ["PC", "Desk"],
    label: "The build",
    title: "The build",
    body: "Lian Li O11D EVO · AORUS RTX 5070 Ti · Corsair H150i · Lian Li SL120 fans, all white cables.",
    view: [-0.25, 0.3, 1],
  },
  StreamDeck: { label: "Lighting", action: "lights" },
  Nanoleaf: { label: "Change the mood", action: "cycle" },
  Quest: {
    groups: ["Quest", "Sofa", "Decor"],
    label: "VR",
    title: "VR & 3D",
    body: "Quest 2, where most of my 3D and XR experiments start.",
    view: [-0.35, 1.3, 0.8],
  },
  Lego: {
    groups: ["Lego", "Shelf"],
    label: "LEGO",
    title: "Off the clock",
    body: "LEGO Technic 42042 crawler crane. Built it, still standing.",
    view: [-0.2, 0.3, 1],
  },
  Logo: {
    groups: ["Decor", "Room"],
    label: "jkeroro.com",
    title: "Jkeroro",
    body: "That's me: cybersecurity student and front-end developer. My personal site has my projects, music and more.",
    link: { text: "Visit jkeroro.com", url: "https://jkeroro.com" },
    view: [0, 0.05, 1],
  },
  Couple: { groups: ["Decor", "Room"], label: "Us", title: "Us", body: "Photo coming soon.", view: [0, 0.05, 1] },
  Doudou: { groups: ["Decor", "Room"], label: "Doudou", title: "Doudou", body: "Our Bichon. Photo coming soon.", view: [0, 0.05, 1] },
};

// Free models used in the room. All CC BY 4.0 from Sketchfab.
// Source of truth: E:\\3D素材\\授权与出处.txt
const SF = "https://sketchfab.com/3d-models/";
export const CREDITS = [
  {
    group: "Desk",
    items: [
      { what: "Samsung Odyssey OLED G9", author: "eltayerkebulan", url: SF + "85967f0cc293466ca6f3016824835817" },
      { what: "Shure SM7B", author: "Yanis", url: SF + "37c21283fcc84f7c9a98e3389e79506c" },
      { what: "beyerdynamic DT900 PRO X", author: "niko.rummukainen", url: SF + "ca0da01d2ff84c5fb6ef0e2a2423b7da" },
      { what: "Logitech G502", author: "teret50", url: SF + "2aefbcd3a16a40b18ae824a689aafd81" },
      { what: "Sony ZV-E10", author: "Innixicated", url: SF + "6584021eb6da4dafa6972efb7f93f528" },
      { what: "Apollo Twin USB", author: "bangviet", url: SF + "01ed1cc21e94419697c2a54493315ab0" },
      { what: "60% mechanical keyboard", author: "ibrahimtaha.fbx", url: SF + "90d61eec0c484332ab562c5f4eda6f52" },
      { what: "Gaming chair (grey)", author: "kanesk06" },
    ],
  },
  {
    group: "PC build",
    items: [
      { what: "Lian Li O11D EVO", author: "pcformed" },
      { what: "GIGABYTE AERO RTX 4090", author: "PolyDavid" },
      { what: "Lian Li UNI FAN SL120", author: "DIEKO" },
      { what: "Corsair H150i Elite", author: "MG990" },
    ],
  },
  {
    group: "Around the room",
    items: [
      { what: "LEGO Technic 42042 Crawler Crane", author: "PGSimulation", url: SF + "6a0154eb8a7b46c89693c03e1e481cdb" },
      { what: "Oculus Quest 2", author: "NosTeam" },
      { what: "Throw pillows", author: "oyugi" },
    ],
  },
  {
    group: "On the water",
    items: [
      { what: "Yellow rubber duck", author: "sanch_aozz", url: SF + "1990cda4c97e400f852d2b4078ebb958" },
      { what: "Koi fish", author: "7plus", url: SF + "236859b809984f52b70c94fd040b9c59" },
    ],
  },
];

/*
 * Background music. Add tracks here and they show up in the music button at
 * the bottom left (it stays hidden on the live site while the list is empty).
 *  - src: a file in public/audio/ (e.g. "/audio/my-song.mp3"), or a full URL
 *    (Vercel Blob or anywhere that serves the file with CORS).
 *  - startOnEnter: start playing when the visitor presses Enter (browsers only
 *    allow sound after a click). A visitor who pauses it stays paused next time.
 */
export const BGM = {
  volume: 0.35,
  startOnEnter: true,
  tracks: [
    // { title: "Song name", artist: "Artist", src: "/audio/song.mp3" },
  ],
};
