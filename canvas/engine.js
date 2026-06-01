/* games.directory globe — Canvas2D engine
 *
 * Thin subclass of BaseEngine (shared/engine.js): all the shared machinery lives
 * there; here we only wire the canvas-specific hooks. Each frame clears the
 * single canvas and redraws visible layers — immediate mode, no persistent nodes.
 */
import { BaseEngine } from "../shared/engine.js";

export class Engine extends BaseEngine {
  constructor(opts) {
    super(opts);
    this.canvas = opts.canvas;
    this.ctx = opts.canvas.getContext("2d", { alpha: true });
  }

  _viewportRect() { return this.canvas.getBoundingClientRect(); }

  _resizeBackend() {
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  _dragTarget() { return this.canvas; }

  _render() {
    this.ctx.clearRect(0, 0, this.W, this.H);
    for (const l of this.layers) {
      if (l.visible && !l.visible(this)) continue;
      l.draw(this);
    }
  }
}
