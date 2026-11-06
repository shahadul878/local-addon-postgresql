'use strict';

/**
 * Runs async tasks one at a time, in call order. A failed task doesn't block later ones.
 * Used so double-clicks, polling and lifecycle hooks can't interleave cluster changes.
 */
function createSerialQueue() {
  let tail = Promise.resolve();

  return function enqueue(task) {
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  };
}

module.exports = { createSerialQueue };
