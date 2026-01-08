import fs from "node:fs";
import path from "node:path";
import { detectTechTopic, buildTechTopicAnswer } from "../server.js";

const knowledgePath = path.join(process.cwd(), "data", "brand_knowledge.json");
const knowledge = JSON.parse(fs.readFileSync(knowledgePath, "utf8"));
const topics = knowledge.topics || {};

const mustTrigger = [
  { text: "شنو الفرق بين google tv و android", expected: "google_tv_vs_android" },
  { text: "google tv vs android", expected: "google_tv_vs_android" },
  { text: "QLED vs mini led", expected: "qled_vs_mini_led" },
  { text: "4k ولا fhd", expected: "4k_vs_fhd" },
  { text: "HDR Dolby Vision", expected: "hdr_dolby_vision" },
  { text: "60hz vs 120hz", expected: "refresh_rate_60_vs_120" },
  { text: "difference qled led", expected: "qled_vs_led" },
];

const mustNotTrigger = ["ثمن 4k", "prix qled", "كم ثمن التلفاز"];

let failed = false;

function fail(msg) {
  failed = true;
  console.error(`FAIL: ${msg}`);
}

for (const test of mustTrigger) {
  const key = detectTechTopic(test.text);
  if (key !== test.expected) {
    fail(`expected ${test.expected} for "${test.text}" but got ${String(key)}`);
    continue;
  }
  const reply = buildTechTopicAnswer(key, "fr");
  const topic = topics[key];
  if (!reply) {
    fail(`missing reply for key ${key}`);
    continue;
  }
  if (!reply.includes("╭──────────────────────────────╮")) {
    fail(`missing header for key ${key}`);
  }
  if (!topic || !topic.title_fr || !reply.includes(topic.title_fr)) {
    fail(`missing title in reply for key ${key}`);
  }
}

for (const text of mustNotTrigger) {
  const key = detectTechTopic(text);
  if (key !== null) {
    fail(`expected null for "${text}" but got ${String(key)}`);
  }
}

if (failed) {
  process.exit(1);
}

console.log("tech-topics tests ok");
