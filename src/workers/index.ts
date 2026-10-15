/**
 * Framework-agnostic wrappers around the compute web workers:
 * {@link WorkerManager} (one worker), {@link WorkerPool} (load-balanced
 * simulations) and {@link FitSession} (one dedicated fitWorker per fit).
 *
 * Call {@link setWorkerBasePath} once before creating any of them.
 *
 * @module
 */

export * from "./env.js";
export * from "./workerStore.js";
export * from "./workerPool.js";
export * from "./fitSession.js";
export * from "./backend.js";
