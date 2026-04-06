import { TERRAIN_SETS, OBJECT_SETS } from './tessellation-data.js';

/**
 * Tessellation Engine
 * Centralizes the rules for tile placement and roles.
 */
export const TessellationEngine = {
    /**
     * Required role names by terrain tessellation type.
     */
    getRequiredRolesByType(typeName) {
        if (typeName === 'conc-conv-a' || typeName === 'conc-conv-b' || typeName === 'conc-conv-c') {
            return ['OUT_NW', 'EDGE_N', 'OUT_NE', 'EDGE_W', 'CENTER', 'EDGE_E', 'OUT_SW', 'EDGE_S', 'OUT_SE', 'IN_NE', 'IN_NW', 'IN_SE', 'IN_SW'];
        }
        if (typeName === 'conc-conv-d') {
            return ['OUT_NW', 'EDGE_N', 'OUT_NE', 'EDGE_W', 'CENTER', 'EDGE_E', 'OUT_SW', 'EDGE_S', 'OUT_SE'];
        }
        if (typeName === 'extentable-vertical-three-piece-a') {
            return ['TOP_EXTREMITY', 'SEAMLESS_CENTER', 'BOTTOM_EXTREMITY'];
        }
        if (typeName === 'extentable-horizontal-three-piece-a') {
            return ['LEFT_EXTREMITY', 'SEAMLESS_CENTER', 'RIGHT_EXTREMITY'];
        }
        if (typeName === 'seamless-horizontal-single-piece-a' || typeName === 'seamless-vertical-single-piece-a') {
            return ['SEAMLESS_TILE'];
        }
        return [];
    },

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
     * Validate one terrain set role mapping.
     * Returns a normalized report used by UI/render warnings.
     */
    validateTerrainSet(name) {
        const set = this.getTerrainSet(name);
        if (!set) {
            return {
                name,
                isValid: false,
                missingRoles: [],
                unknownRoles: [],
                error: 'set_not_found'
            };
        }

        const requiredRoles = this.getRequiredRolesByType(set.type);
        const roles = set.roles || {};
        const roleNames = Object.keys(roles);
        const missingRoles = requiredRoles.filter((role) => roles[role] == null);
        const unknownRoles = roleNames.filter((role) => !requiredRoles.includes(role));

        return {
            name,
            type: set.type,
            isValid: missingRoles.length === 0,
            missingRoles,
            unknownRoles
        };
    },

    /**
     * Validate all terrain sets and collect only problematic entries.
     */
    validateAllTerrainSets() {
        const reports = [];
        for (const setName of Object.keys(TERRAIN_SETS)) {
            const report = this.validateTerrainSet(setName);
            if (!report.isValid || report.unknownRoles.length > 0) {
                reports.push(report);
            }
        }
        return reports;
    },

    /**
     * Helper to get relative image path from TSX path.
     * Assumes tileset images are in the same folder as the TSX with .png extension.
     */
    getImagePath(tsxPath) {
        if (!tsxPath) return '';
        if (tsxPath.endsWith('.png')) return tsxPath; // Já é um caminho relativo de imagem
        
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
                ['OUT_NW', 'EDGE_N', 'OUT_NE', 'IN_SE', 'IN_SW'],
                ['EDGE_W', 'CENTER', 'EDGE_E', 'IN_NE', 'IN_NW'],
                ['OUT_SW', 'EDGE_S', 'OUT_SE'],
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
