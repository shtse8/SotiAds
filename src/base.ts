
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
    toUpdate: [S, T][] // [source, target]
    toRemove: T[]
}
export function listChanges<S, T>(
    source: S[],
    target: T[],
    comparator: (a: S, b: T) => boolean = (a: any, b: any) => a === b
): listChangesPayload<S, T> {
    // Track the count of items from source to be added or updated
    const sourceCountMap = new Map<S, number>();
    source.forEach(s => {
        sourceCountMap.set(s, (sourceCountMap.get(s) || 0) + 1);
    });

    const toAdd: S[] = [];
    const toUpdate: [S, T][] = []
    const toRemove: T[] = [];

    // Track already matched target items to avoid duplicate processing
    const matchedTargets = new Set<T>();

    target.forEach(t => {
        let foundMatch = false;

        for (const [s, count] of sourceCountMap) {
            if (comparator(s, t)) {
                if (!matchedTargets.has(t)) {
                    toUpdate.push([s, t]);
                    matchedTargets.add(t);
                    foundMatch = true;

                    // Decrease the count for the matched source item
                    if (count === 1) {
                        sourceCountMap.delete(s);
                    } else {
                        sourceCountMap.set(s, count - 1);
                    }
                    break;
                }
            }
        }

        if (!foundMatch) {
            toRemove.push(t);
        }
    });

    // Remaining source items are to be added
    sourceCountMap.forEach((count, s) => {
        for (let i = 0; i < count; i++) {
            toAdd.push(s);
        }
    });

    return { toAdd, toUpdate, toRemove };
}