import { TERRAIN_SETS, OBJECT_SETS } from './tessellation-data.js';

/**
 * Tessellation Engine
 * Centralizes the rules for tile placement and roles.
 */
export const TessellationEngine = {
    /**
     * Get all available terrain set names.
     */
    getTerrainSetNames() {
        return Object.keys(TERRAIN_SETS);
    },

    /**
     * Get all available object set names.
     */
    getObjectSetNames() {
        return Object.keys(OBJECT_SETS);
    },

    /**
     * Get full data for a terrain set.
     */
    getTerrainSet(name) {
        return TERRAIN_SETS[name] || null;
    },

    /**
     * Get full data for an object set.
     */
    getObjectSet(name) {
        return OBJECT_SETS[name] || null;
    },

    /**
     * Get a specific tile ID by set name and role.
     */
    getRoleTile(setName, role) {
        const set = this.getTerrainSet(setName);
        if (!set) return null;
        return set.roles[role] || null;
    },

    /**
     * Helper to get relative image path from TSX path.
     * Assumes tileset images are in the same folder as the TSX with .png extension.
     */
    getImagePath(tsxPath) {
        if (!tsxPath) return '';
        // Convert H:/.../tilesets/file.tsx to tilesets/file.png
        const parts = tsxPath.split(/[/\\]/);
        const fileName = parts[parts.length - 1];
        const baseName = fileName.replace('.tsx', '');
        return `tilesets/${baseName}.png`;
    },

    /**
     * Utility to get 13-role grid layout (3x5 or similar) for UI.
     * Returns an array of rows, where each row is an array of roles.
     */
    getGridLayout(typeName) {
        // These match the logic in fix-tsx.js
        if (typeName === 'conc-conv-a') {
            return [
                ['OUT_NW', 'EDGE_N', 'OUT_NE'],
                ['EDGE_W', 'CENTER', 'EDGE_E', 'IN_SE', 'IN_SW'],
                ['OUT_SW', 'EDGE_S', 'OUT_SE', 'IN_NE', 'IN_NW'],
            ];
        } else if (typeName === 'conc-conv-b') {
            return [
                ['OUT_NW', 'EDGE_N', 'OUT_NE', 'IN_SE', 'IN_SW'],
                ['EDGE_W', 'CENTER', 'EDGE_E', 'IN_NE', 'IN_NW'],
                ['OUT_SW', 'EDGE_S', 'OUT_SE'],
            ];
        } else if (typeName === 'conc-conv-c') {
            return [
                ['OUT_NW', 'EDGE_N/IN_EDGE_S', 'OUT_NE', 'IN_SE', 'IN_SW'],
                ['EDGE_W', 'CENTER', 'EDGE_E', 'IN_EDGE_E', 'IN_EDGE_W'],
                ['OUT_SW', 'EDGE_S/IN_EDGE_N', 'OUT_SE', 'IN_NE', 'IN_NW'],
            ];
        }
        return null;
    },

    /**
     * Reconstruct an object set into a 2D grid of IDs.
     * Uses relative ID positions to determine the visual shape.
     */
    getObjectGrid(name) {
        const set = this.getObjectSet(name);
        if (!set) return null;

        const cols = set.file.includes('caves') ? 50 : 57;
        const allIds = [];
        set.parts.forEach(p => allIds.push(...p.ids));
        if (allIds.length === 0) return null;

        const tiles = allIds.map(id => ({
            id,
            x: id % cols,
            y: Math.floor(id / cols)
        }));

        const minX = Math.min(...tiles.map(t => t.x));
        const minY = Math.min(...tiles.map(t => t.y));
        const maxX = Math.max(...tiles.map(t => t.x));
        const maxY = Math.max(...tiles.map(t => t.y));

        const width = maxX - minX + 1;
        const height = maxY - minY + 1;

        const grid = Array.from({ length: height }, () => Array(width).fill(null));
        tiles.forEach(t => {
            grid[t.y - minY][t.x - minX] = t.id;
        });

        return grid;
    }
};
