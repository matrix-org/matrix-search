export {};
declare global {
    interface Set<T> {
        intersect<T>(s: Set<T>): Set<T>;
        union<T>(s: Set<T>): Set<T>;
        toJSON(): any;
    }
    interface Map<K, V> {
        toJSON(): any;
    }
}

Set.prototype.intersect = function<T>(s: Set<T>): Set<T> {
    return new Set<T>([...this].filter(x => s.has(x)));
};
Set.prototype.union = function<T>(s: Set<T>): Set<T> {
    return new Set<T>([...this, ...s]);
};
Set.prototype.toJSON = function(): any {
    return [...this];
};

Map.prototype.toJSON = function(): any {
    const obj = Object.create(null);
    for (let [k,v] of this) {
        obj[k] = v;
    }
    return obj;
};