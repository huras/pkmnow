# Fill IN_SW, IN_NE, IN_NW (and IN_SE when missing) for every 2x2 IN_* block.
# Pattern: [[IN_SE, IN_SW], [IN_NE, IN_NW]] with columns=57
# IN_SW = IN_SE + 1, IN_NE = IN_SE + 57, IN_NW = IN_SE + 58
#
# Discovers IN_SE from: (1) tiles with role IN_SE, (2) neighbors: IN_SW->id-1, IN_NE->id-57, IN_NW->id-58.
# So blocks are processed even when IN_SE has no class/terrain or no role yet.

import re

COLUMNS = 57
TSX_PATH = "flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx"

# Role property: allow optional type="..." before />
ROLE_PROP_RE = re.compile(r'<property\s+name="role"\s+value="[^"]*"\s*(?:type="[^"]*")?\s*/>')

def main():
    with open(TSX_PATH, "r", encoding="utf-8") as f:
        content = f.read()

    tile_start = re.compile(r'<tile\s+id="(\d+)"([^>]*?)(>|\/>)')

    # Collect all tile blocks: id -> (start, end, block)
    tiles = {}
    for m in tile_start.finditer(content):
        tid = int(m.group(1))
        brace = m.group(3)
        start = m.start()
        if brace == "/>":
            end = m.end()
        else:
            end_m = re.search(r"</tile>", content[start:])
            end = start + end_m.end() if end_m else start
        tiles[tid] = (start, end, content[start:end])

    # Discover IN_SE ids from:
    # 1) Tiles that have role="IN_SE" (any format, with or without type=)
    # 2) Tiles that have IN_SW -> IN_SE = id - 1
    # 3) Tiles that have IN_NE -> IN_SE = id - 57
    # 4) Tiles that have IN_NW -> IN_SE = id - 58
    in_se_ids = set()
    for tid, (_, _, block) in tiles.items():
        if re.search(r'<property\s+name="role"\s+value="IN_SE"\s*(?:type="[^"]*")?\s*/>', block):
            in_se_ids.add(tid)
        if re.search(r'<property\s+name="role"\s+value="IN_SW"\s*(?:type="[^"]*")?\s*/>', block):
            in_se_ids.add(tid - 1)
        if re.search(r'<property\s+name="role"\s+value="IN_NE"\s*(?:type="[^"]*")?\s*/>', block):
            in_se_ids.add(tid - 57)
        if re.search(r'<property\s+name="role"\s+value="IN_NW"\s*(?:type="[^"]*")?\s*/>', block):
            in_se_ids.add(tid - 58)

    # Only keep in_se_ids that are valid (non-negative; upper bound from tileset tilecount if needed)
    in_se_ids = {x for x in in_se_ids if x >= 0}

    print("IN_SE tile ids (from role + neighbors):", len(in_se_ids), sorted(in_se_ids))

    # For each of the four positions we need this role
    to_set = {}
    for tid in in_se_ids:
        to_set[tid] = "IN_SE"
        to_set[tid + 1] = "IN_SW"
        to_set[tid + 57] = "IN_NE"
        to_set[tid + 58] = "IN_NW"

    replacements = []

    for tid, (start, end, block) in tiles.items():
        if tid not in to_set:
            continue
        new_role = to_set[tid]

        # Self-closing tile
        m_open = tile_start.search(block)
        if m_open and m_open.group(3) == "/>":
            attrs = m_open.group(2)
            new_block = (
                f'<tile id="{tid}"{attrs}>\n  <properties>\n   '
                f'<property name="role" value="{new_role}"/>'
                "\n  </properties>\n </tile>"
            )
            replacements.append((start, end, new_block, -1))
            continue

        # Has <properties>...</properties>
        if ROLE_PROP_RE.search(block):
            new_block = ROLE_PROP_RE.sub(
                f'<property name="role" value="{new_role}"/>',
                block,
                count=1
            )
        else:
            new_block = re.sub(
                r"(<properties>\s*)",
                r"\1\n   " + f'<property name="role" value="{new_role}"/>',
                block,
                count=1
            )
        replacements.append((start, end, new_block, -1))

    # Create missing tiles: IN_SW, IN_NE, IN_NW that don't exist in the TSX yet
    # (e.g. 2308 has IN_SE but 2309 has no <tile> element -> create it)
    # Only when IN_SE tile exists in file (so we have an insertion point).
    for in_se_id in in_se_ids:
        if in_se_id not in tiles:
            continue
        for partner_id, role in [(in_se_id + 1, "IN_SW"), (in_se_id + 57, "IN_NE"), (in_se_id + 58, "IN_NW")]:
            if partner_id in tiles:
                continue  # already handled above
            # Insert new tile right after the IN_SE block
            _, in_se_end, _ = tiles[in_se_id]
            new_block = (
                f'\n <tile id="{partner_id}">\n  <properties>\n   '
                f'<property name="role" value="{role}"/>'
                "\n  </properties>\n </tile>"
            )
            replacements.append((in_se_end, in_se_end, new_block, partner_id))

    # Apply from end to start so indices stay valid. For insertions at same position,
    # apply higher partner_id first so order is 2309, 2365, 2366.
    for start, end, new_block, _ in sorted(replacements, key=lambda x: (-x[0], -x[3] if x[3] >= 0 else 0)):
        content = content[:start] + new_block + content[end:]

    # Re-order all tiles by id (TSX expects / looks better with tiles sorted by id)
    tiles_sorted = []
    tile_ends = []
    for m in tile_start.finditer(content):
        tid = int(m.group(1))
        brace = m.group(3)
        start = m.start()
        if brace == "/>":
            end = m.end()
        else:
            end_m = re.search(r"</tile>", content[start:])
            end = start + end_m.end() if end_m else start
        tiles_sorted.append((tid, content[start:end]))
        tile_ends.append((start, end))
    tiles_sorted.sort(key=lambda x: x[0])
    first_start = min(s for s, _ in tile_ends)
    last_end = max(e for _, e in tile_ends)
    header_end = content.rfind("\n", 0, first_start) + 1
    content = (
        content[:header_end]
        + "\n".join(block for _, block in tiles_sorted)
        + content[last_end:]
    )

    with open(TSX_PATH, "w", encoding="utf-8") as f:
        f.write(content)

    n_created = sum(1 for r in replacements if r[3] >= 0)
    print("Done. Updated", len(replacements), "tiles (" + str(n_created), "created). Tiles re-ordered by id.")

if __name__ == "__main__":
    main()
