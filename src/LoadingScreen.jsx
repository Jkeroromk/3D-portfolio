import { useProgress } from "@react-three/drei";

export const LoadingScreen = ({ started, onStarted, loading }) => {
  const { progress, active, loaded, total } = useProgress();

  console.log("Progress:", progress);
  console.log("Active:", active);
  console.log("Loaded:", loaded, "Total:", total);

  return (
    <div className={`loadingScreen ${started ? "loadingScreen--started" : ""}`}>
      <div className="loadingScreen__progress">
        <div
          className="loadingScreen__progress__value"
          style={{
            width: `${progress}%`,
          }}
        />
      </div>
      <div className="loadingScreen__board">
        <h1 className="loadingScreen__title">Welcome to my place</h1>
        <button
          className="loadingScreen__button"
          onClick={onStarted}
        >
          View
        </button>
      </div>
    </div>
  );
};
