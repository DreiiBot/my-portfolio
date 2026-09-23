# Projection route: REQUIRED (maximum-likeness character)
- Camera: camera.json (fov 18deg vertical, level, distance 10, image plane z=0 spans 3.1677 units).
- Albedo: albedo-delit-soft.png (strength 0.22, blur 90, confidence 0.53). The first pass (0.45, auto blur) was rejected on review: silhouette halo and jacket lifted to blue-grey.
- Bake plans: bake-bust-surface.json, bake-hair.json (perspective-camera-projection, 1200px, palette-continue for unseen).
- Runtime: UVs are baked per vertex from the reference camera at build time, with a depth-visibility test
  so surfaces hidden from the camera (under the chin, behind the ears, the back) fall back to palette colours.
