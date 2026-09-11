import "./app.css";
import { mount } from "svelte";

import App from "./App.svelte";
import { configureMixer } from "./lib/engine";
import { mixerController } from "./lib/mixer-controller";
import { project } from "./lib/project";
import { rendering } from "./lib/render";
import "@fortawesome/fontawesome-free/js/all.min.js";
import "@fortawesome/fontawesome-free/css/all.min.css";

const target = document.getElementById("app");
if (!target) {
  throw new Error("Could not find app element");
}

const mixerSync = mixerController(configureMixer);
project.subscribe((p) => mixerSync.project(p));
rendering.subscribe((active) => mixerSync.rendering(active));

const app = mount(App, { target });

export default app;
