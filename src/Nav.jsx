import { useState, useEffect, useRef } from "react";

export default function NavBar({ started, onSelectView }) {
  const [activeIndex, setActiveIndex] = useState(0); // Track the active item
  const navRef = useRef();

  const handleItemClick = (index, view) => {
    setActiveIndex(index); // Update the active item index
    onSelectView(view); // Notify the parent component of the selected view
  };

  useEffect(() => {
    const items = navRef.current.querySelectorAll(".navbar__item");
    const square = navRef.current.querySelector(".navbar__square");

    if (items.length && square) {
      const activeItem = items[activeIndex];
      const { offsetLeft, offsetWidth } = activeItem;

      square.style.left = `${offsetLeft}px`; // Align square horizontally
      square.style.width = `${offsetWidth}px`; // Match width of the active item
    }
  }, [activeIndex]); // Update position whenever the activeIndex changes

  return (
    <div className={`navbar ${started ? "navbar--visible" : ""}`} ref={navRef}>
      <div className="navbar__square"></div> {/* The moving square */}
      <ul className="navbar__list">
        <li
          className="navbar__item link-hover-effect"
          onClick={() => handleItemClick(0, "default")}
        >
          Home
        </li>
        <li
          className="navbar__item link-hover-effect"
          onClick={() => handleItemClick(1, "workplace")}
        >
          WorkPlace
        </li>
        <li
          className="navbar__item link-hover-effect"
          onClick={() => handleItemClick(2, "personal")}
        >
          Personal
        </li>
      </ul>
    </div>
  );
}
