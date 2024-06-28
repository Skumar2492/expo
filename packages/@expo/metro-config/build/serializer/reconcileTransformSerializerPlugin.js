"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPostTreeShakeTransformSerializerPlugin = void 0;
/**
 * Copyright © 2023 650 Industries.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
const core_1 = require("@babel/core");
const generator_1 = __importDefault(require("@babel/generator"));
const assert_1 = __importDefault(require("assert"));
const JsFileWrapping_1 = __importDefault(require("metro/src/ModuleGraph/worker/JsFileWrapping"));
const collectDependencies_1 = __importStar(require("metro/src/ModuleGraph/worker/collectDependencies"));
const countLines_1 = __importDefault(require("metro/src/lib/countLines"));
const metro_source_map_1 = require("metro-source-map");
const metro_transform_plugins_1 = __importDefault(require("metro-transform-plugins"));
const treeShakeSerializerPlugin_1 = require("./treeShakeSerializerPlugin");
const metro_transform_worker_1 = require("../transform-worker/metro-transform-worker");
const sideEffectsSerializerPlugin_1 = require("./sideEffectsSerializerPlugin");
const debug = require('debug')('expo:treeshaking');
const FORCE_REQUIRE_NAME_HINTS = false;
class InvalidRequireCallError extends Error {
    innerError;
    filename;
    constructor(innerError, filename) {
        super(`${filename}:${innerError.message}`);
        this.innerError = innerError;
        this.filename = filename;
    }
}
function assertCollectDependenciesOptions(collectDependenciesOptions) {
    if (!collectDependenciesOptions) {
        throw new Error('collectDependenciesOptions is required. Something is wrong with the metro transformer or transform cache.');
    }
    if (typeof collectDependenciesOptions !== 'object') {
        throw new Error('collectDependenciesOptions must be an object.');
    }
    (0, assert_1.default)('inlineableCalls' in collectDependenciesOptions, 'inlineableCalls is required.');
}
// This is the insane step which reconciles the second half of the transformation process but it does it uncached at the end of the bundling process when we have tree shaking completed.
function createPostTreeShakeTransformSerializerPlugin(config) {
    return async function treeShakeSerializer(entryPoint, preModules, graph, options) {
        if (!(0, treeShakeSerializerPlugin_1.isShakingEnabled)(graph, options)) {
            return [entryPoint, preModules, graph, options];
        }
        const preserveEsm = false;
        // Convert all remaining AST and dependencies to standard output that Metro expects.
        // This is normally done in the transformer, but we skipped it so we could perform graph analysis (tree-shake).
        for (const value of graph.dependencies.values()) {
            for (const index in value.output) {
                value.output[index] = await transformDependencyOutput(value, value.output[index]);
            }
        }
        return [entryPoint, preModules, graph, options];
        async function transformDependencyOutput(value, outputItem) {
            if (outputItem.type !== 'js/module' || value.path.endsWith('.json')) {
                debug('Skipping post transform for non-js/module: ' + value.path);
                return outputItem;
            }
            // This should be cached by the transform worker for use here to ensure close to consistent
            // results between the tree-shake and the final transform.
            const reconcile = outputItem.data.reconcile;
            // const collectDependenciesOptions = outputItem.data.collectDependenciesOptions;
            assertCollectDependenciesOptions(reconcile.collectDependenciesOptions);
            let ast = (0, treeShakeSerializerPlugin_1.accessAst)(outputItem);
            if (!ast) {
                throw new Error('missing AST for ' + value.path);
            }
            // @ts-expect-error: TODO
            delete outputItem.data.ast;
            const importDefault = reconcile.collectDependenciesOptions.inlineableCalls[0];
            const importAll = reconcile.collectDependenciesOptions.inlineableCalls[1];
            // const { importDefault, importAll } = generateImportNames(ast);
            const sideEffectReferences = [...value.dependencies.values()]
                .filter((dep) => {
                const fullDep = graph.dependencies.get(dep.absolutePath);
                return fullDep && (0, sideEffectsSerializerPlugin_1.hasSideEffectWithDebugTrace)(options, graph, fullDep)[0];
            })
                .map((dep) => dep.data.name);
            // Add side-effects to the ignore list.
            const nonInlinedRequires = graph.transformOptions.nonInlinedRequires
                ? sideEffectReferences.concat(graph.transformOptions.nonInlinedRequires)
                : sideEffectReferences;
            const babelPluginOpts = {
                ...graph.transformOptions,
                inlineableCalls: [importDefault, importAll],
                importDefault,
                importAll,
                nonInlinedRequires,
            };
            // @ts-expect-error: TODO
            ast = (0, core_1.transformFromAstSync)(ast, undefined, {
                ast: true,
                babelrc: false,
                code: false,
                configFile: false,
                filename: value.path,
                plugins: [
                    // functionMapBabelPlugin,
                    metro_transform_worker_1.renameTopLevelModuleVariables,
                    [metro_transform_plugins_1.default.importExportPlugin, babelPluginOpts],
                    // TODO: Add support for disabling safe inline requires.
                    [metro_transform_plugins_1.default.inlineRequiresPlugin, babelPluginOpts],
                ].filter(Boolean),
                sourceMaps: false,
                // // Not-Cloning the input AST here should be safe because other code paths above this call
                // // are mutating the AST as well and no code is depending on the original AST.
                // // However, switching the flag to false caused issues with ES Modules if `experimentalImportSupport` isn't used https://github.com/facebook/metro/issues/641
                // // either because one of the plugins is doing something funky or Babel messes up some caches.
                // // Make sure to test the above mentioned case before flipping the flag back to false.
                // cloneInputAst: true,
            })?.ast;
            // TODO: Test a JSON, asset, and script-type module from the transformer since they have different handling.
            let dependencyMapName = '';
            let dependencies;
            // This pass converts the modules to use the generated import names.
            try {
                // console.log(require('@babel/generator').default(ast).code);
                // Rewrite the deps to use Metro runtime, collect the new dep positions.
                // TODO: We could just update the deps in the graph to use the correct positions after we modify the AST. This seems hard and fragile though.
                ({ ast, dependencies, dependencyMapName } = (0, collectDependencies_1.default)(ast, {
                    ...reconcile.collectDependenciesOptions,
                    // This is here for debugging purposes.
                    keepRequireNames: FORCE_REQUIRE_NAME_HINTS,
                    // This setting shouldn't be shared + it can't be serialized and cached anyways.
                    dependencyTransformer: undefined,
                }));
            }
            catch (error) {
                if (error instanceof collectDependencies_1.InvalidRequireCallError) {
                    throw new InvalidRequireCallError(error, value.path);
                }
                throw error;
            }
            // @ts-expect-error: Mutating the value in place.
            value.dependencies =
                //
                sortDependencies(dependencies, value.dependencies);
            const results = JsFileWrapping_1.default.wrapModule(ast, importDefault, importAll, dependencyMapName, 
            // TODO: Share these with transformer
            reconcile.globalPrefix, 
            // @ts-expect-error
            reconcile.unstable_renameRequire === false);
            const wrappedAst = results.ast;
            const source = value.getSource().toString('utf-8');
            const reserved = [];
            if (reconcile.unstable_dependencyMapReservedName != null) {
                reserved.push(reconcile.unstable_dependencyMapReservedName);
            }
            // https://github.com/facebook/metro/blob/6151e7eb241b15f3bb13b6302abeafc39d2ca3ad/packages/metro-config/src/defaults/index.js#L128C28-L128C38
            const optimizationSizeLimit = reconcile.optimizationSizeLimit ?? 150 * 1024;
            if (reconcile.minify &&
                source.length <= optimizationSizeLimit &&
                !reconcile.unstable_disableNormalizePseudoGlobals) {
                // This MUST run before `generate` as it mutates the ast out of place.
                reserved.push(...metro_transform_plugins_1.default.normalizePseudoGlobals(wrappedAst, {
                    reservedNames: reserved,
                }));
            }
            const result = (0, generator_1.default)(wrappedAst, {
                // comments: true,
                // https://github.com/facebook/metro/blob/6151e7eb241b15f3bb13b6302abeafc39d2ca3ad/packages/metro-config/src/defaults/index.js#L137
                compact: reconcile.unstable_compactOutput,
                filename: value.path,
                retainLines: false,
                sourceFileName: value.path,
                sourceMaps: true,
            }, outputItem.data.code);
            let map = result.rawMappings ? result.rawMappings.map(metro_source_map_1.toSegmentTuple) : [];
            let code = result.code;
            if (reconcile.minify && !preserveEsm) {
                ({ map, code } = await (0, metro_transform_worker_1.minifyCode)({ minifierPath: reconcile.minifierPath, minifierConfig: reconcile.minifierConfig }, config.projectRoot, value.path, result.code, source, map, reserved));
            }
            // console.log(code);
            // console.log(require('@babel/generator').default(ast).code);
            return {
                ...outputItem,
                data: {
                    ...outputItem.data,
                    code,
                    map,
                    lineCount: (0, countLines_1.default)(code),
                    functionMap: 
                    // @ts-expect-error: https://github.com/facebook/metro/blob/6151e7eb241b15f3bb13b6302abeafc39d2ca3ad/packages/metro-transform-worker/src/index.js#L508-L512
                    ast.metadata?.metro?.functionMap ??
                        // @ts-expect-error: Fallback to deprecated explicitly-generated `functionMap`
                        ast.functionMap ??
                        null,
                },
            };
        }
    };
}
exports.createPostTreeShakeTransformSerializerPlugin = createPostTreeShakeTransformSerializerPlugin;
// Some imports may change order during the transform, so we need to resort them.
// Resort the dependencies to match the current order of the AST.
function sortDependencies(dependencies, accordingTo) {
    // Some imports may change order during the transform, so we need to resort them.
    // Resort the dependencies to match the current order of the AST.
    const nextDependencies = new Map();
    // Metro uses this Map hack so we need to create a new map and add the items in the expected order/
    dependencies.forEach((dep) => {
        nextDependencies.set(dep.data.key, {
            ...(accordingTo.get(dep.data.key) || {}),
            data: dep,
        });
    });
    return nextDependencies;
}
// TODO: The dep sorting seems to break on this module when it isn't sorted.
// https://github.com/software-mansion/react-native-gesture-handler/blob/main/src/handlers/gestureHandlerCommon.ts
// https://github.com/software-mansion/react-native-gesture-handler/blob/e95f85345dd9e9a4d4ff67fbaa0a0a2abbe3bccb/src/handlers/gestureHandlerCommon.ts#L281C5-L281C21
//# sourceMappingURL=reconcileTransformSerializerPlugin.js.map