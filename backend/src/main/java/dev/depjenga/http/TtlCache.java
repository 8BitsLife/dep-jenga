package dev.depjenga.http;

import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/** Tiny in-memory TTL cache. Stores Optional so negative lookups (404s) are cached too. */
public class TtlCache<V> {
    private record Entry<V>(Optional<V> value, long expiresAt) {}

    private final ConcurrentHashMap<String, Entry<V>> map = new ConcurrentHashMap<>();
    private final long ttlMs;
    private final int maxSize;

    public TtlCache(long ttlMs, int maxSize) {
        this.ttlMs = ttlMs;
        this.maxSize = maxSize;
    }

    /** Returns null when absent/expired, otherwise the cached Optional. */
    public Optional<V> get(String key) {
        Entry<V> e = map.get(key);
        if (e == null) return null;
        if (e.expiresAt() < System.currentTimeMillis()) {
            map.remove(key);
            return null;
        }
        return e.value();
    }

    public void put(String key, V value) {
        if (map.size() > maxSize) map.clear();
        map.put(key, new Entry<>(Optional.ofNullable(value), System.currentTimeMillis() + ttlMs));
    }
}
