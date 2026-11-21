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
            <h2>Credits</h2>
            <p>
              The room is modelled and lit in Blender. These free models from Sketchfab are used
              under CC BY 4.0:
            </p>
            <ul>
              {CREDITS.map((c) => (
                <li key={c.what}>
                  {c.url ? (
                    <a href={c.url} target="_blank" rel="noopener noreferrer">
                      <strong>{c.what}</strong>
                    </a>
                  ) : (
                    <strong>{c.what}</strong>
                  )}{" "}
                  by {c.author}
                </li>
              ))}
            </ul>
            <button onClick={() => setRoomState({ credits: false })}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}
