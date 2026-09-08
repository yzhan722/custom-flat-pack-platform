/**
 * @cfp/core — deterministic engineering kernel for the custom flat-pack platform.
 *
 * Pipeline: DesignSpec → rules → panels/operations → hardware BOM → packaging →
 * assembly guide → price → (after approval) immutable production release.
 * Nothing in this package talks to a database, a machine or a language model.
 */

export * from "./units";
export * from "./ids";
export * from "./catalog";
export * from "./design";
export * from "./measurement";
export * from "./panels";
export * from "./hardware";
export * from "./packaging";
export * from "./assembly";
export * from "./pricing";
export * from "./rules";
export * from "./engineering";
export * from "./orders";
export * from "./release";
export * from "./ai";
