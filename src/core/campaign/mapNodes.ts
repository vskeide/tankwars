/**
 * Route node positions on campaign-map.png as fractions of the image size, in
 * route order (base camp bottom-left → fortress top-right). Read off the art by
 * hand; tools/map_nodes.py is a starting point but the salt flats confuse a pure
 * colour detector, so these are curated. Thirteen of the fourteen painted markers
 * are used, one per level.
 */
export const MAP_NODES: { x: number; y: number }[] = [
  { x: 0.105, y: 0.8 },
  { x: 0.155, y: 0.68 },
  { x: 0.183, y: 0.534 },
  { x: 0.228, y: 0.414 },
  { x: 0.311, y: 0.355 },
  { x: 0.395, y: 0.414 },
  { x: 0.467, y: 0.534 },
  { x: 0.528, y: 0.69 },
  { x: 0.7, y: 0.72 },
  { x: 0.834, y: 0.672 },
  { x: 0.86, y: 0.513 },
  { x: 0.878, y: 0.355 },
  { x: 0.917, y: 0.237 },
];
