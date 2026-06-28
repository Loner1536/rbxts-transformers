export type FnTypes = {
    params: Array<string | null>;
    ret: string | null;
};
export declare function injectTypeAnnotations(src: string, types: Map<string, FnTypes>): string;
export declare function stripUselessBlockComments(src: string): string;
export declare function fixBlockCommentOpeners(src: string): string;
export declare function organizePreamble(src: string): string;
export declare function hoistGetService(src: string): string;
export declare function promoteConstIfUnmutated(src: string, name: string): string;
export declare function promoteConsts(src: string): string;
export declare function addSpacing(src: string): string;
export declare function castTsImports(src: string): string;
export type FnDoc = {
    desc: string[];
    params: Map<string, string>;
    returns: string;
    deprecated?: string;
};
export declare function injectJsDocFromSidecar(src: string, sidecar: Map<string, FnDoc>): string;
export declare function convertJsDocComments(src: string): string;
export declare function applyDirectives(src: string, strict: boolean, optimizeLevel: false | 0 | 1 | 2): string;
export declare function formatFile(luauPath: string, strict: boolean, optimizeLevel: false | 0 | 1 | 2, sidecar?: Map<string, FnDoc>, types?: Map<string, FnTypes>): void;
