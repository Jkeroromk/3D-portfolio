import { useProgress } from "@react-three/drei";
import { CREDITS } from "./roomConfig.js";
import { setRoomState, useRoomState } from "./roomStore.js";

// HTML controls shown on top of the WorkPlace room: day/night switch and credits.
export default function RoomOverlay() {
  const { night, credits, loadingNight, ready } = useRoomState();
  const { progress } = useProgress();

  return (
    <>
      <div className={`room-loader ${ready ? "room-loader--done" : ""}`} aria-hidden={ready}>
        <div className="room-loader__title">Loading my room</div>
        <div className="room-loader__bar">
          <div className="room-loader__fill" style={{ width: `${Math.max(4, Math.round(progress))}%` }} />
        </div>
        <div className="room-loader__pct">{Math.round(progress)}%</div>
      </div>

      <button
        className={`room-toggle ${night ? "room-toggle--night" : ""}`}
        onClick={() => setRoomState({ night: !night })}
        aria-label={night ? "Switch to day" : "Switch to night"}
        title={night ? "Day" : "Night"}
      >
        <span className="room-toggle__knob">{night ? "☾" : "☀"}</span>
        {loadingNight && <span className="room-toggle__loading" />}
      </button>

      <button className="room-credits-link" onClick={() => setRoomState({ credits: true })}>
        Credits
      </button>

      {credits && (
        <div className="room-credits" onClick={() => setRoomState({ credits: false })}>
          <div className="room-credits__panel" onClick={(e) => e.stopPropagation()}>
            <button
              className="room-credits__close"
              onClick={() => setRoomState({ credits: false })}
              aria-label="Close credits"
            >
              ×
            </button>
            <div className="room-credits__eyebrow">WorkPlace</div>
            <h2>Credits</h2>
            <p className="room-credits__lead">
              My room, rebuilt and lit in Blender. Everything else on these shelves came from
              these generous Sketchfab artists, used under <strong>CC BY 4.0</strong>.
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
            <div className="room-credits__foot">Room, layout, lighting and bake: Jkeroro × Claude · Blender 5.2</div>
          </div>
        </div>
      )}
    </>
  );
}
