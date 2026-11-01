export function EditorToolIcon({ id }) {
  const common = { width: 18, height: 18, viewBox: "0 0 18 18", fill: "none", "aria-hidden": true };

  switch (id) {
    case "undo":
      return (
        <svg {...common}>
          <path d="M6 4.5 3.5 7 6 9.5M3.5 7h5.5a4.5 4.5 0 1 1 0 9H8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case "redo":
      return (
        <svg {...common}>
          <path d="M12 4.5 14.5 7 12 9.5M14.5 7H9a4.5 4.5 0 0 0 0 9h1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case "bold":
      return (
        <svg {...common}>
          <path d="M6.5 3.5H9.8c1.8 0 3.2 1.2 3.2 2.9 0 1.1-.6 2-1.5 2.5 1.2.5 2 1.6 2 3 0 2-1.6 3.6-3.8 3.6H6.5V3.5Z" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      );
    case "italic":
      return (
        <svg {...common}>
          <path d="M10 3.5H7M11 14.5H8M9.5 3.5 8.5 14.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    case "underline":
      return (
        <svg {...common}>
          <path d="M5 3.5v5.2a4 4 0 0 0 8 0V3.5M4.5 14.5h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    case "strike":
      return (
        <svg {...common}>
          <path
            d="M11.2 6.4H7.4c-1.35 0-2.15.85-2.15 1.75 0 1 .85 1.55 2.15 1.85 1.45.35 2.35.95 2.35 2.05 0 1.15-1.05 2-2.75 2H6.3"
            stroke="currentColor"
            strokeWidth="1.35"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M3.75 9h10.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
        </svg>
      );
    case "h1":
      return <span className="editor-tool-text">H1</span>;
    case "h2":
      return <span className="editor-tool-text">H2</span>;
    case "h3":
      return <span className="editor-tool-text">H3</span>;
    case "p":
      return <span className="editor-tool-text">P</span>;
    case "ul":
      return (
        <svg {...common}>
          <path d="M7 5h7M7 9h7M7 13h7M3.5 5h.01M3.5 9h.01M3.5 13h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "ol":
      return (
        <svg {...common}>
          <path d="M7 5h7M7 9h7M7 13h7M3.5 4.5v3M3.5 8.5v3M3.2 4.5h.6M3.2 8.5h.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    case "quote":
      return (
        <svg {...common}>
          <path d="M5 6.5c-1.2 0-2 .9-2 2.1v2.4h3V8.5H5.2M11 6.5c-1.2 0-2 .9-2 2.1v2.4h3V8.5H11.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    case "link":
      return (
        <svg {...common}>
          <path d="M7.2 10.8 10.8 7.2M6.4 12.2l-1.3 1.3a1.8 1.8 0 0 0 0 2.6l.1.1a1.8 1.8 0 0 0 2.6 0l1.3-1.3M11.6 5.8l1.3-1.3a1.8 1.8 0 0 1 2.6 0l.1.1a1.8 1.8 0 0 1 0 2.6l-1.3 1.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    case "image":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
          <path d="m6.5 11.5 2-2 2.5 2.5L12 10l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <circle cx="7" cy="7" r="1" fill="currentColor" />
        </svg>
      );
    case "left":
      return (
        <svg {...common}>
          <path d="M3.5 5h11M3.5 9h8M3.5 13h11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    case "center":
      return (
        <svg {...common}>
          <path d="M3.5 5h11M5 9h8M3.5 13h11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    case "right":
      return (
        <svg {...common}>
          <path d="M3.5 5h11M6 9h8.5M3.5 13h11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    case "clear":
      return (
        <svg {...common}>
          <path d="M5.5 4.5 12.5 13.5M12.5 4.5 5.5 13.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    default:
      return null;
  }
}
