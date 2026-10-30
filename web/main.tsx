import { createRoot } from "react-dom/client";
import "./styles.css";

function App() {
  return <main className="main"><h1>Practy</h1></main>;
}

createRoot(document.getElementById("root")!).render(<App />);
