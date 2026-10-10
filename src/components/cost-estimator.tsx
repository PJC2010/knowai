"use client";

import { useState } from "react";
import Link from "next/link";
import type { Model, ModelsData } from "@/lib/types";
import { dateLabel } from "@/lib/format";
import { playgroundHref } from "@/lib/playground-link";
import {
  cheapestPaid,
  clampPerDay,
  formatEstimate,
  freeCapableCount,
  monthlyCost,
  perUseCost,
  taskPresets,
  type TaskPreset,
} from "@/lib/task-costs";

function EstimateTable({
  caption,
  models,
  preset,
  perDay,
}: {
  caption: string;
  models: Model[];
  preset: TaskPreset;
  perDay: number;
}) {
  return (
    <table className="estimate-table">
      <caption>{caption}</caption>
      <thead>
        <tr><th scope="col">Model</th><th scope="col">Per use</th><th scope="col">Per month</th><th scope="col"><span className="sr-only">Try it</span></th></tr>
      </thead>
      <tbody>
        {models.map((model) => {
          const capable = cheapestPaid([model], preset, 1).length > 0 || freeCapableCount([model], preset) > 0;
          return (
            <tr key={model.id}>
              <th scope="row" data-label="Model">{model.name}</th>
              <td data-label="Per use">{capable ? formatEstimate(perUseCost(model, preset), 0.0001) : "Unavailable"}</td>
              <td data-label="Per month">{capable ? formatEstimate(monthlyCost(model, preset, perDay), 0.01) : "Unavailable"}</td>
              <td data-label="Try it">
                {capable ? <Link href={playgroundHref({ models: [model.id], prompt: preset.samplePrompt })} aria-label={`Try it with ${model.name}`}>Try it</Link> : <span>Not available for this task</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function CostEstimator({ data, selected }: { data: ModelsData; selected: Model[] }) {
  const [taskId, setTaskId] = useState(taskPresets[0].id);
  const [perDayText, setPerDayText] = useState("10");
  const preset = taskPresets.find((task) => task.id === taskId) ?? taskPresets[0];
  const perDay = clampPerDay(perDayText);
  const cheapest = cheapestPaid(data.models, preset);
  const freeCount = freeCapableCount(data.models, preset);

  return (
    <section className="cost-estimator" aria-labelledby="cost-estimator-title">
      <h2 id="cost-estimator-title">What would it cost me?</h2>
      <p>Pick an everyday task to see what it would cost each month with different models. No account needed.</p>
      <div className="estimate-controls">
        <label>Task
          <select value={taskId} onChange={(event) => setTaskId(event.target.value)}>
            {taskPresets.map((task) => <option key={task.id} value={task.id}>{task.label}</option>)}
          </select>
        </label>
        <label>Times per day
          <input type="number" min={1} max={10000} step={1} value={perDayText}
            onChange={(event) => setPerDayText(event.target.value)}
            onBlur={() => setPerDayText(String(clampPerDay(perDayText)))} />
        </label>
      </div>
      {cheapest.length ? (
        <EstimateTable caption="Cheapest paid models for this task" models={cheapest} preset={preset} perDay={perDay} />
      ) : (
        <p className="estimate-empty">No paid models in this catalog have listed prices and enough token capacity for this task.</p>
      )}
      {selected.length > 0 && <EstimateTable caption="Your selected models" models={selected} preset={preset} perDay={perDay} />}
      {freeCount > 0 && <p className="estimate-free-note">{freeCount} free models can also handle this task. Free models can have rate limits and may change or disappear.</p>}
      <p className="estimate-disclaimer">Estimates use list prices from the {data.fallback ? `saved catalog from ${dateLabel(data.fetchedAt)}` : "live OpenRouter catalog"} and typical token counts for each task. Real costs vary with length, reasoning, and caching.</p>
    </section>
  );
}
