import { useProgress } from "@react-three/drei";
import { useEffect, useRef, useState } from "react";
import { CREDITS, HOTSPOTS } from "./roomConfig.js";
import { getRoomState, setRoomState, useRoomState } from "./roomStore.js";
import { live, PRESETS, PRESET_ORDER } from "./lighting.js";

// Keep the page backdrop and UI accent in step with the room's lighting, so the
// whole page changes mood with the room, not just the 3D part.
function useAmbientCss() {
  useEffect(() => {
    let raf;
    let last = "";
    const root = document.documentElement;
    const tick = () => {
      const top = "#" + live.bgTop.getHexString();
      const bottom = "#" + live.bgBottom.getHexString();
      const accent = "#" + live.accent.getHexString();
      const key = top + bottom + accent;
      if (key !== last) {
        root.style.setProperty("--bg-top", top);
        root.style.setProperty("--bg-bottom", bottom);
        root.style.setProperty("--accent", accent);
        last = key;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);
}

function Landing() {
  const { ready, started } = useRoomState();
  const { progress } = useProgress();
  const pct = ready ? 100 : Math.min(99, Math.round(progress));
  return (
    <div className={`room-landing ${started ? "room-landing--gone" : ""}`} aria-hidden={started}>
      <div className="room-landing__inner">
        <div className="room-landing__eyebrow">Jkeroro</div>
        <h1 className="room-landing__title">Welcome to my room</h1>
        <p className="room-landing__sub">Everything in here is something I use, build or love. Click around.</p>
        <div className="room-landing__bar">
          <div className="room-landing__fill" style={{ width: `${Math.max(3, pct)}%` }} />
        </div>
        <button className="room-landing__enter" disabled={!ready} onClick={() => setRoomState({ started: true })}>
          {ready ? "Enter" : `Loading ${pct}%`}
        </button>
      </div>
    </div>
  );
}

function StreamDeck() {
  const { preset, loadingNight, deckPulse, cyclePreset } = useRoomState();
  const [pulse, setPulse] = useState(false);

  // Clicking the Stream Deck in the room makes this panel flash
  useEffect(() => {
    if (!deckPulse) return;
    setPulse(true);
    const id = setTimeout(() => setPulse(false), 900);
    return () => clearTimeout(id);
  }, [deckPulse]);

  // Clicking the Nanoleaf panel steps through the night moods
  useEffect(() => {
    if (!cyclePreset) return;
    const cur = getRoomState().preset;
    const moods = PRESET_ORDER.filter((k) => k !== "day");
    const next = moods[(moods.indexOf(cur) + 1) % moods.length];
    setRoomState({ preset: next });
  }, [cyclePreset]);

  return (
    <div className={`deck ${pulse ? "deck--pulse" : ""}`} aria-label="Lighting presets">
      <div className="deck__title">
        Lighting {loadingNight && <span className="deck__spinner" aria-label="Loading" />}
      </div>
      <div className="deck__grid">
        {PRESET_ORDER.map((key) => {
          const p = PRESETS[key];
          return (
            <button
              key={key}
              className={`deck__key ${preset === key ? "deck__key--on" : ""}`}
              style={{ "--key": p.accent }}
              onClick={() => setRoomState({ preset: key })}
              title={p.label}
            >
              <span className="deck__icon">{p.icon}</span>
              <span className="deck__label">{p.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function HoverLabel() {
  const { hover, focus } = useRoomState();
  const ref = useRef();
  useEffect(() => {
    const move = (e) => {
      if (ref.current) ref.current.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 14}px)`;
    };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, []);
  const label = hover && !focus ? HOTSPOTS[hover]?.label : null;
  return (
    <div ref={ref} className={`room-hover ${label ? "room-hover--on" : ""}`}>
      {label}
    </div>
  );
}

function FocusCard() {
  const { focus } = useRoomState();
  const cfg = focus ? HOTSPOTS[focus] : null;
  const [shown, setShown] = useState(null);
  // keep the last card's content while it fades out
  useEffect(() => {
    if (cfg && cfg.title) setShown(cfg);
  }, [focus]);
  const open = !!(cfg && cfg.title);
  return (
    <div className={`room-card ${open ? "room-card--open" : ""}`} aria-hidden={!open}>
      {shown && (
        <>
          <h2>{shown.title}</h2>
          <p>{shown.body}</p>
          <div className="room-card__actions">
            {shown.link && (
              <a className="room-card__link" href={shown.link.url} target="_blank" rel="noopener noreferrer">
                {shown.link.text} ↗
              </a>
            )}
            <button className="room-card__back" onClick={() => setRoomState({ focus: null })}>
              ← Back
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Credits() {
  const { credits } = useRoomState();
  if (!credits) return null;
  return (
    <div className="room-credits" onClick={() => setRoomState({ credits: false })}>
      <div className="room-credits__panel" onClick={(e) => e.stopPropagation()}>
        <button className="room-credits__close" onClick={() => setRoomState({ credits: false })} aria-label="Close credits">
          ×
        </button>
        <div className="room-credits__eyebrow">The room</div>
        <h2>Credits</h2>
        <p className="room-credits__lead">
          My room, rebuilt and lit in Blender. A lot of what's on the desk came from these generous Sketchfab artists,
          used under <strong>CC BY 4.0</strong>.
        </p>
        {CREDITS.map((section) => (
          <section key={section.group} className="room-credits__section">
            <h3>{section.group}</h3>
            <ul>
              {section.items.map((c) => {
                const body = (
                  <>
                    <span className="room-credits__what">{c.what}</span>
                    <span className="room-credits__by">by {c.author}</span>
                  </>
                );
                return (
                  <li key={c.what}>
                    {c.url ? (
                      <a className="room-credits__item" href={c.url} target="_blank" rel="noopener noreferrer">
                        {body}
                        <span className="room-credits__arrow">↗</span>
                      </a>
                    ) : (
                      <div className="room-credits__item">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        <div className="room-credits__foot">Room, layout, lighting and bake: Jkeroro · Blender 5.2</div>
      </div>
    </div>
  );
}

export default function RoomOverlay() {
  useAmbientCss();
  const { started, focus } = useRoomState();
  return (
    <>
      <div className="room-vignette" />
      <Landing />
      <div className={`room-ui ${started ? "room-ui--on" : ""} ${focus ? "room-ui--focus" : ""}`}>
        <div className="room-hint">Drag to look around · click things to explore</div>
        <StreamDeck />
        <button className="room-credits-link" onClick={() => setRoomState({ credits: true })}>
          Credits
        </button>
      </div>
      <HoverLabel />
      <FocusCard />
      <Credits />
    </>
  );
}
