export default function NavBar({ started, onSelectView }) {
    return (
      <div className={`navbar ${started ? "navbar--visible" : ""}`}>
        <ul className="navbar__list">
          <li className="navbar__item link-hover-effect" onClick={() => onSelectView("default")}>Home</li>
          <li className="navbar__item link-hover-effect" onClick={() => onSelectView("workplace")}>WorkPlace</li>
          <li className="navbar__item link-hover-effect" onClick={() => onSelectView("personal")}>Personal</li>
        </ul>
      </div>
    );
  }
  