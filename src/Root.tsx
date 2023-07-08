import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

export function Root() {
  return (
    <BrowserRouter>
      <App />
    </BrowserRouter>
  );
}
