"""Render REYZ's authored infinity ribbon in Blender 4.3+.

Website asset: blender -b --python tools/render_brand.py -- --out /tmp/reyz-frames --single 0
The geometry, lighting and motion are original scene code, not stock footage.
The published asset is a WebP still used in an interactive Canvas composition.
Optional sequences are intermediate renders, not a claim of published video.
"""
import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def aim(obj, point):
    obj.rotation_euler = (Vector(point) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def color(code):
    values = [int(code[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in values) + (1,)


args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
parser = argparse.ArgumentParser()
parser.add_argument('--out', type=Path, required=True)
parser.add_argument('--frames', type=int, default=120)
parser.add_argument('--width', type=int, default=1440)
parser.add_argument('--single', type=int)
opt = parser.parse_args(args)
opt.out.mkdir(parents=True, exist_ok=True)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE_NEXT'
scene.render.resolution_x = opt.width
scene.render.resolution_y = round(opt.width * 9 / 16)
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGB'
scene.render.fps = 24
scene.render.film_transparent = False
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'
scene.view_settings.exposure = -.4
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = color('0A0A0A')
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = .25

material = bpy.data.materials.new('REYZ / satin pink titanium')
material.use_nodes = True
shader = material.node_tree.nodes.get('Principled BSDF')
shader.inputs['Base Color'].default_value = color('F715AC')
shader.inputs['Metallic'].default_value = .82
shader.inputs['Roughness'].default_value = .23
shader.inputs['Coat Weight'].default_value = .28
shader.inputs['Coat Roughness'].default_value = .18

segments, bands = 384, 10
vertices, faces = [], []


def centre(t):
    d = 1 + math.sin(t) ** 2
    return Vector((3.4 * math.cos(t) / d, .58 * math.sin(t), 2.5 * math.sin(t) * math.cos(t) / d))


for i in range(segments):
    t = i / segments * math.tau
    p = centre(t)
    tangent = (centre(t + .0001) - centre(t - .0001)).normalized()
    normal = tangent.cross(Vector((0, 1, 0))).normalized()
    binormal = tangent.cross(normal).normalized()
    twist = .58 * math.sin(t * 2) + .3
    width = .30 + .065 * math.cos(t * 2)
    for j in range(bands + 1):
        u = j / bands * 2 - 1
        across = normal * math.cos(twist) + binormal * math.sin(twist)
        relief = binormal * (.035 * (1 - u * u))
        vertices.append(tuple(p + across * width * u + relief))
for i in range(segments):
    nxt = (i + 1) % segments
    for j in range(bands):
        a, b = i * (bands + 1) + j, nxt * (bands + 1) + j
        faces.append((a, b, b + 1, a + 1))
mesh = bpy.data.meshes.new('Continuous authored ribbon')
mesh.from_pydata(vertices, [], faces)
mesh.update()
ribbon = bpy.data.objects.new('REYZ infinity', mesh)
bpy.context.collection.objects.link(ribbon)
ribbon.data.materials.append(material)
for face in ribbon.data.polygons:
    face.use_smooth = True
solid = ribbon.modifiers.new('Machined thickness', 'SOLIDIFY')
solid.thickness = .038
bevel = ribbon.modifiers.new('Soft optical edges', 'BEVEL')
bevel.width = .025
bevel.segments = 3

# A darker second surface gives a deliberate, continuous edge rather than glow.
edge_mat = material.copy()
edge_mat.name = 'REYZ / blackened edge'
edge_mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = color('24091D')
ribbon.data.materials.append(edge_mat)
solid.material_offset = 1
solid.material_offset_rim = 1

floor_mat = bpy.data.materials.new('REYZ matte black')
floor_mat.use_nodes = True
floor_bsdf = floor_mat.node_tree.nodes.get('Principled BSDF')
floor_bsdf.inputs['Base Color'].default_value = color('0A0A0A')
floor_bsdf.inputs['Roughness'].default_value = .36
floor_bsdf.inputs['Metallic'].default_value = .25
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -1.82))
floor = bpy.context.object
floor.name = 'Continuous black ground'
floor.data.materials.append(floor_mat)


def area(name, position, energy, size, tint='FAFAFA', size_y=None):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = energy
    data.color = color(tint)[:3]
    data.shape = 'RECTANGLE'
    data.size = size
    data.size_y = size_y or size
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = position
    aim(obj, (0, 0, 0))
    return obj


area('Long softbox', (-2, -4, 6), 1700, 6.5, size_y=1.8)
rim = area('Precision rim', (3, 3, 4), 2200, 4.0, size_y=.55)
area('Pink edge', (-5, 1, 1), 1000, 4.5, 'F715AC', .5)
area('Front reflection', (1, -6, 1), 650, 3.0, size_y=.6)

camera_data = bpy.data.cameras.new('REYZ studio camera')
camera = bpy.data.objects.new('REYZ studio camera', camera_data)
bpy.context.collection.objects.link(camera)
camera_data.type = 'ORTHO'
camera_data.ortho_scale = 8.7
scene.camera = camera

frames = [opt.single] if opt.single is not None else range(opt.frames)
for frame in frames:
    phase = math.tau * frame / opt.frames
    ribbon.rotation_euler = (.07 * math.sin(phase), .075 * math.cos(phase), -.075)
    ribbon.location.z = .09 * math.sin(phase)
    camera.location = (1.1 + .45 * math.sin(phase), -10.8, 2.8 + .14 * math.cos(phase))
    aim(camera, (0, 0, -.1))
    rim.data.energy = 2100 + 150 * math.sin(phase)
    scene.render.filepath = str(opt.out / f'{frame:04d}.png')
    bpy.ops.render.render(write_still=True)
print(f'REYZ scene rendered: {len(frames)} frames at {scene.render.resolution_x}x{scene.render.resolution_y}')
