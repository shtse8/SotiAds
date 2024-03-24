
export enum AdFormat {
    Internal = 'Internal',
    Interstitial = 'Interstitial',
    Rewarded = 'Rewarded',
    Banner = 'Banner',
    RewardedInterstitial = 'RewardedInterstitial',
    AppOpen = 'AppOpen',
    Native = 'Native'
}

export enum Platform {
    Android = 'Android',
    iOS = 'iOS'
}


function deepEquals(a: any, b: any): b is typeof a {
    // Check if both are the same reference or both are null/undefined
    if (a === b) return true;
    // If either is null/undefined (but not both, as that would have returned true above), return false
    if (a == null || b == null) return false;
    // Check if both are objects (including arrays, functions, etc)
    if (typeof a === 'object' && typeof b === 'object') {
        // Check if both are instances of the same class
        if (a.constructor !== b.constructor) return false;
        // Handle Arrays
        if (Array.isArray(a)) {
            // Check array length equality
            if (a.length !== b.length) return false;
            // Recursively check each element
            for (let i = 0; i < a.length; i++) {
                if (!deepEquals(a[i], b[i])) return false;
            }
            return true;
        }
        // Handle Objects
        const aKeys = Object.keys(a);
        const bKeys = Object.keys(b);
        // Check if both objects have the same number of keys
        if (aKeys.length !== bKeys.length) return false;
        // Check if both objects have the same keys and recursively check values
        for (const key of aKeys) {
            if (!b.hasOwnProperty(key) || !deepEquals(a[key], b[key])) return false;
        }
        return true;
    }
    // If none of the above, values are of different types or not equal
    return false;
}

export interface listChangesPayload<S, T> {
    toAdd: S[]
    toUpdate: Map<S, T>
    toRemove: T[]
}
export function listChanges<S, T>(
    source: S[],
    target: T[],
    comparator: (a: S, b: T) => boolean = (a: any, b: any) => a === b
): listChangesPayload<S, T> {
    const toAdd: S[] = []
    const toUpdate = new Map<S, T>()
    const toRemove: T[] = []
    for (const s of source) {
        const t = target.find(x => comparator(s, x))
        if (!t) {
            toAdd.push(s)
        } else {
            toUpdate.set(s, t)
        }
    }
    for (const t of target) {
        const s = source.find(x => comparator(x, t))
        if (!s) {
            toRemove.push(t)
        }
    }
    return { toAdd, toUpdate, toRemove }
}
