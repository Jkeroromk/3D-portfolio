import { useProgress } from "@react-three/drei";

export const LoadingScreen = ({ started, onStarted }) => {
  const { progress } = useProgress();
  const isLoading = progress < 100;

  return (
    <div className={`loadingScreen ${started ? "loadingScreen--started" : ""}`}>
      <div className="loadingScreen__board">
        <h1 className="loadingScreen__title">Welcome to my place</h1>
        <div className="loadingScreen__progress">
          <div
            className={`loadingScreen__progress__value ${!isLoading ? "loadingScreen__progress__value--complete" : ""}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <button
          className="loadingScreen__button"
          disabled={isLoading}
          onClick={onStarted}
        >
          View
        </button>
      </div>
    </div>
  );
};
