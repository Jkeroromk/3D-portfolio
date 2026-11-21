// Everything the baked WorkPlace room needs to know about the exported files.
// The Blender export script writes public/models/room/manifest.json; this file
// only holds the things a person decides by hand (links, labels, credits).

export const ROOM_BASE = "./models/room/";

// Objects that open a link when clicked. `url: null` means "not decided yet":
// the object is still shown, but it is not clickable.
export const LINKS = {
  Hit_G9: { label: "KeroCam", url: "https://kerocam.jkeroro.com" },
  Hit_Logo: { label: "Jkeroro", url: null },
  Hit_Couple: { label: "Us", url: null },
  Hit_Doudou: { label: "Doudou", url: null },
};

// Free models used in the room. All CC BY 4.0 from Sketchfab.
// Source of truth: E:\\3D素材\\授权与出处.txt
const SF = "https://sketchfab.com/3d-models/";
export const CREDITS = [
  { what: "Samsung Odyssey OLED G9", author: "eltayerkebulan", url: SF + "85967f0cc293466ca6f3016824835817" },
  { what: "Shure SM7B", author: "Yanis (@notbadworks)", url: SF + "37c21283fcc84f7c9a98e3389e79506c" },
  { what: "beyerdynamic DT900 PRO X", author: "niko.rummukainen", url: SF + "ca0da01d2ff84c5fb6ef0e2a2423b7da" },
  { what: "Logitech G502", author: "teret50 (@teret_50)", url: SF + "2aefbcd3a16a40b18ae824a689aafd81" },
  { what: "Sony ZV-E10", author: "Innixicated", url: SF + "6584021eb6da4dafa6972efb7f93f528" },
  { what: "Apollo Twin USB", author: "bangviet", url: SF + "01ed1cc21e94419697c2a54493315ab0" },
  { what: "60% mechanical keyboard", author: "unknown.fbx (@ibrahimtaha.fbx)", url: SF + "90d61eec0c484332ab562c5f4eda6f52" },
  { what: "LEGO Technic 42042 Crawler Crane", author: "PGSimulation (@lama99)", url: SF + "6a0154eb8a7b46c89693c03e1e481cdb" },
  { what: "Oculus Quest 2", author: "NosTeam" },
  { what: "Gaming chair (grey)", author: "kanesk06" },
  { what: "Throw pillows", author: "oyugi" },
  { what: "Lian Li O11D EVO build", author: "pcformed" },
  { what: "GIGABYTE AERO RTX 4090", author: "PolyDavid" },
  { what: "Lian Li UNI FAN SL120", author: "DIEKO" },
  { what: "Corsair H150i Elite", author: "MG990" },
];
