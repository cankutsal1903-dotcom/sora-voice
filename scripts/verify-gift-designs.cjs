/* Read-only integrity/lifecycle checks. Run: node scripts/verify-gift-designs.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Module = require("node:module");
const parser = require("@babel/parser");
const babel = require("@babel/core");
const generate = require("@babel/generator").default;
const { PNG } = require("pngjs");

const root = path.resolve(__dirname, "..");
const artworkPath = path.join(root, "src/ui/SoraGiftArtwork.js");
const recipesPath = path.join(root, "src/ui/giftEffectRecipes.js");
const effectPath = path.join(root, "src/ui/SoraGiftEffect.js");
const parse = (filename) => parser.parse(fs.readFileSync(filename, "utf8"), { sourceType: "module", plugins: ["jsx"] });
const artworkAst = parse(artworkPath);
const effectsAst = parse(effectPath);

function findNode(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) { const match = findNode(item, predicate); if (match) return match; }
    } else if (value && typeof value === "object") {
      const match = findNode(value, predicate);
      if (match) return match;
    }
  }
  return null;
}

const variable = (name) => {
  const declaration = findNode(artworkAst, (node) => node.type === "VariableDeclarator" && node.id.name === name);
  assert.ok(declaration, `Missing ${name}`);
  return declaration.init;
};
const catalog = variable("DEFAULT_GIFT_CATALOG");
assert.equal(catalog.type, "ArrayExpression");
const ids = catalog.elements.map((entry) => entry.properties.find((prop) => prop.key.name === "id")?.value.value);
assert.equal(ids.length, 34, "Expected all 34 gifts");
assert.equal(new Set(ids).size, 34, "Duplicate gift IDs");

const sources = variable("GIFT_ARTWORK_SOURCES");
assert.equal(sources.type, "ObjectExpression");
const imageById = new Map(sources.properties.map((property) => {
  assert.equal(property.value.type, "CallExpression", "Artwork must use a static require");
  assert.equal(property.value.callee.name, "require");
  assert.equal(property.value.arguments[0].type, "StringLiteral");
  return [property.key.name || property.key.value, path.resolve(path.dirname(artworkPath), property.value.arguments[0].value)];
}));
assert.equal(imageById.size, 34, "Expected one bundled artwork for each catalog ID");

function compileModule(filename, plugins, customRequire) {
  const compiled = babel.transformFileSync(filename, { babelrc: false, configFile: false, plugins }).code;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = module.paths;
  if (customRequire) loaded.require = customRequire;
  loaded._compile(compiled, filename);
  return loaded.exports;
}
const recipeExports = compileModule(recipesPath, ["@babel/plugin-transform-modules-commonjs"]);
const { GIFT_EFFECT_RECIPES: recipes, GIFT_EFFECT_PHASES: phases } = recipeExports;
assert.equal(Object.keys(recipes).length, 34);
assert.deepEqual(phases, [0, 0.16, 0.34, 0.56, 0.8, 1]);

const trajectoryNode = findNode(effectsAst, (node) => node.type === "FunctionDeclaration" && node.id.name === "getGiftParticlePath");
assert.ok(trajectoryNode, "Missing particle trajectory generator");
const getPath = vm.runInNewContext(
  `const radians = degrees => degrees * Math.PI / 180; ${generate(trajectoryNode).code}; getGiftParticlePath;`,
  {}, { timeout: 1000 },
);
const heroStories = new Set();
const errors = [];
let pathsChecked = 0, imagesChecked = 0;
for (const id of ids) {
  const recipe = recipes[id];
  assert.ok(recipe, `${id}: missing effect recipe`);
  assert.match(recipe.color, /^#[\da-f]{6}$/i, `${id}: invalid color`);
  assert.match(recipe.accent, /^#[\da-f]{6}$/i, `${id}: invalid accent`);
  assert.ok(recipe.duration >= 2400 && recipe.duration <= 4500, `${id}: duration outside bounded range`);
  const count = recipe.count || 12;
  assert.ok(Number.isInteger(count) && count >= 1 && count <= 18, `${id}: unbounded particles`);
  for (const axis of ["x", "y", "scale", "rotate"]) {
    assert.equal(recipe.hero[axis].length, phases.length, `${id}: bad ${axis} phases`);
    assert.ok(recipe.hero[axis].every(Number.isFinite), `${id}: non-finite ${axis}`);
  }
  assert.ok(recipe.hero.scale.every((scale) => scale > 0 && scale <= 1.5), `${id}: unsafe hero scale`);
  heroStories.add(JSON.stringify(recipe.hero));
  for (let index = 0; index < count; index++) {
    const trajectory = getPath(recipe, index, count);
    for (const axis of ["x", "y"]) {
      assert.equal(trajectory[axis].length, phases.length, `${id}: bad particle phases`);
      assert.ok(trajectory[axis].every((value) => Number.isFinite(value) && Math.abs(value) <= 2), `${id}: invalid particle coordinates`);
    }
    pathsChecked++;
  }
  const filename = imageById.get(id);
  if (!filename || !fs.existsSync(filename)) { errors.push(`${id}: artwork PNG missing`); continue; }
  try {
    const png = PNG.sync.read(fs.readFileSync(filename));
    assert.ok(png.width >= 256 && png.height >= 256, "artwork below 256px");
    assert.ok(png.width <= 2048 && png.height <= 2048, "artwork unnecessarily large");
    // Sample a grid: real transparent backdrop and visible art must both exist.
    const stepX = Math.max(1, Math.floor(png.width / 64));
    const stepY = Math.max(1, Math.floor(png.height / 64));
    let transparent = 0, visible = 0, sampled = 0;
    for (let y = 0; y < png.height; y += stepY) {
      for (let x = 0; x < png.width; x += stepX) {
        const alpha = png.data[(y * png.width + x) * 4 + 3];
        if (alpha <= 8) transparent++;
        if (alpha >= 200) visible++;
        sampled++;
      }
    }
    assert.ok(transparent / sampled > 0.08, "PNG lacks a real transparent backdrop");
    assert.ok(visible / sampled > 0.05, "PNG contains too little visible artwork");
    imagesChecked++;
  } catch (error) { errors.push(`${id}: ${error.message}`); }
}
assert.equal(heroStories.size, 34, "Each gift must have a distinct authored hero trajectory");

// Exercise the actual component with a deterministic hook host; Android rendering
// remains a device check. No implementation source is copied into these tests.
let hookHost = null, nativeStarts = 0, nativeStops = 0, reducedMotion = false;
const sameDeps = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
const reactStub = {
  memo: (component) => component,
  useRef: (initial) => {
    const index = hookHost.index++;
    return hookHost.slots[index] ||= { current: initial };
  },
  useState: (initial) => {
    const host = hookHost, index = host.index++;
    if (!(index in host.slots)) host.slots[index] = initial;
    return [host.slots[index], (next) => {
      const value = typeof next === "function" ? next(host.slots[index]) : next;
      if (!Object.is(value, host.slots[index])) { host.slots[index] = value; host.dirty = true; }
    }];
  },
  useCallback: (callback, dependencies) => {
    const index = hookHost.index++, previous = hookHost.slots[index];
    if (!previous || !sameDeps(previous.dependencies, dependencies)) hookHost.slots[index] = { callback, dependencies };
    return hookHost.slots[index].callback;
  },
  useEffect: (callback, dependencies) => {
    const index = hookHost.index++, previous = hookHost.slots[index];
    if (!previous || !sameDeps(previous.dependencies, dependencies)) {
      const host = hookHost;
      host.effects.push(() => { previous?.cleanup?.(); host.slots[index] = { dependencies, cleanup: callback() }; });
    }
  },
};
const createElement = (type, props) => ({ type, props });
const rnStub = {
  Animated: {
    Value: class { setValue() {} interpolate(config) { return config; } },
    timing: () => ({ start: () => { nativeStarts++; }, stop: () => { nativeStops++; } }), View: "Animated.View",
  },
  Easing: { linear: (value) => value },
  StyleSheet: { create: (styles) => styles, absoluteFillObject: {} },
  View: "View", Text: "Text", useWindowDimensions: () => ({ width: 360, height: 720 }),
};
const effectExports = compileModule(effectPath, [
  ["@babel/plugin-transform-react-jsx", { runtime: "automatic" }], "@babel/plugin-transform-modules-commonjs",
], (name) => {
  if (name === "react") return reactStub;
  if (name === "react/jsx-runtime") return { jsx: createElement, jsxs: createElement };
  if (name === "react-native") return rnStub;
  if (name === "expo-linear-gradient") return { LinearGradient: "LinearGradient" };
  if (name === "./Motion") return { useReducedMotion: () => reducedMotion };
  if (name === "./SoraGiftArtwork") return { SoraGiftArtwork: "Artwork", resolveGiftRecipeKey: (id) => id };
  if (name === "./giftEffectRecipes") return recipeExports;
  throw new Error(`Unexpected effect dependency ${name}`);
});
function createHookHost(component) {
  return {
    slots: [], effects: [], index: 0, dirty: false, tree: null,
    render(props) {
      this.props = props;
      let attempts = 0;
      do {
        assert.ok(++attempts <= 12, "Effect state update loop");
        this.index = 0; this.effects = []; this.dirty = false; hookHost = this;
        this.tree = component(props);
        for (const effect of this.effects) effect();
      } while (this.dirty);
      hookHost = null;
      return this.tree;
    },
    unmount() { for (const slot of this.slots) slot?.cleanup?.(); },
  };
}
const queueHost = createHookHost(effectExports.SoraGiftEffect);
const event = (eventId) => ({ id: "minik_kalp", name: "Minik Kalp", eventId });
queueHost.render({ gift: event("a") });
assert.equal(queueHost.tree.props.gift.eventId, "a");
for (const id of ["b", "c", "d", "e", "e"]) queueHost.render({ gift: event(id) });
for (const expected of ["c", "d", "e"]) {
  queueHost.tree.props.onComplete(); queueHost.render(queueHost.props);
  assert.equal(queueHost.tree.props.gift.eventId, expected, "Bound waiting gifts and deduplicate repeated events");
}
queueHost.tree.props.onComplete();
assert.equal(queueHost.render(queueHost.props), null, "Queue finishes after the last event");
queueHost.render({ gift: event("f") }); queueHost.render({ gift: event("g") });
assert.equal(queueHost.render({ gift: null }), null, "Minimizing clears the overlay");
assert.equal(queueHost.render({ gift: event("f") }), null, "Restoring does not replay stale events");
queueHost.render({ gift: event("h") });
assert.equal(queueHost.tree.props.gift.eventId, "h", "Fresh events play after cancellation");
const sceneHost = createHookHost(queueHost.tree.type);
sceneHost.render(queueHost.tree.props);
assert.equal(nativeStarts, 0, "Cold artwork must not consume the native animation before it loads");
const artworkNode = findNode(sceneHost.tree, (node) => node.type === "Artwork");
assert.equal(typeof artworkNode?.props.onLoad, "function", "Hero artwork needs a real image load callback");
artworkNode.props.onLoad();
sceneHost.render(sceneHost.props);
assert.equal(nativeStarts, 1, "Gift scene starts one native animation");
sceneHost.unmount();
assert.equal(nativeStops, 1, "Unmount stops the native animation");
reducedMotion = true;
const reducedHost = createHookHost(queueHost.tree.type);
reducedHost.render(queueHost.tree.props);
const reducedArtwork = findNode(reducedHost.tree, (node) => node.type === "Artwork");
reducedArtwork.props.onLoad();
reducedHost.render(reducedHost.props);
assert.equal(nativeStarts, 1, "Reduced motion does not start a native animation");
reducedHost.unmount(); queueHost.unmount();

let failedArtworkCompleted = 0;
const failedHost = createHookHost(queueHost.tree.type);
failedHost.render({ gift: event("broken-image"), onComplete: () => { failedArtworkCompleted++; } });
const failedArtwork = findNode(failedHost.tree, (node) => node.type === "Artwork");
assert.equal(typeof failedArtwork?.props.onError, "function");
const originalWarn = console.warn;
try { console.warn = () => {}; failedArtwork.props.onError(); } finally { console.warn = originalWarn; }
assert.equal(failedArtworkCompleted, 1, "A failed image must release the gift queue");
failedHost.unmount();

console.log(`Gifts: ${ids.length}; unique choreographies: ${heroStories.size}; particle paths: ${pathsChecked}; valid transparent PNGs: ${imagesChecked}/34`);
console.log("Lifecycle: bounded queue, deduplication, hidden-room cancellation, cold-image wait, image-error recovery, native cleanup, reduced motion passed.");
if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
else console.log("Gift artwork and animation integrity checks passed.");
