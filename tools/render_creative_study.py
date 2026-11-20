"""Render REYZ's original moving paper study; the scene has no external media inputs.

Run with Blender 4.3 or later and FFmpeg on PATH:
    blender -b -t 4 -P tools/render_creative_study.py
Preview an individual frame without creating delivery files:
    blender -b -t 4 -P tools/render_creative_study.py -- --preview /tmp/study.png --frame 1
Render only the two double-resolution stills used by the Creative case preview:
    blender -b -t 4 -P tools/render_creative_study.py -- --stills
The same commands run with the `bpy` Python module (`python3 tools/render_creative_study.py -- --stills`).
"""
import argparse
import math
from pathlib import Path
import subprocess
import sys
import tempfile

import bpy
from mathutils import Vector

FRAMES = 96
FPS = 24
WIDTH, HEIGHT = 1280, 674
OUTPUT = Path(__file__).resolve().parent.parent / 'site/assets/editorial'
# The case preview is cropped to a tall frame on wide screens, so its two versions are
# rendered at twice the film size. Frame 1 is the closed fan; frame 49 is the widest opening.
STILLS = ((1, 'creative-study-still-1.webp'), (49, 'creative-study-still-2.webp'))
STILL_SCALE = 200


def paper(name, color, roughness):
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*color, 1)
    material.use_nodes = True
    shader = material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = roughness
    return material


def surface(name, vertices, faces, material, thickness=0.024, smooth=False):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    if smooth:
        for face in obj.data.polygons:
            face.use_smooth = True
    if thickness:
        skin = obj.modifiers.new('Paper edge', 'SOLIDIFY')
        skin.thickness = thickness
        skin.offset = 0
        bevel = obj.modifiers.new('Edge highlight', 'BEVEL')
        bevel.width = thickness * .35
        bevel.segments = 3
    return obj


def fan_vertices(opening):
    # Fold lines radiate from the bound foot; the outer edge is slightly scalloped.
    vertices = []
    for i in range(35):
        t = i / 34
        theta = (-1.53 + 2.83 * t) * opening
        crease = (i % 2) * .36
        radius = 1.86 + .43 * t - .045 * (i % 2)
        for r in (.01, radius):
            vertices.append((r * math.sin(theta), r * (.08 + crease / radius), r * math.cos(theta)))
    return vertices


def folded_fan(material):
    verts = fan_vertices(1)
    obj = surface('Radial pleat / warm white', verts,
                  [(2*i, 2*i+2, 2*i+3, 2*i+1) for i in range(34)], material, .016)
    obj.shape_key_add(name='Open')
    key = obj.shape_key_add(name='Gather')
    for point, value in zip(key.data, fan_vertices(.73)):
        point.co = value
    obj.location = (-1.65, .54, .01)
    obj.rotation_euler.z = -.19
    return key


def arch(material):
    # A continuous strip bends over towards the floor, with a gently cut diagonal rim.
    verts = []
    steps = 72
    for i in range(steps + 1):
        theta = math.pi * i / steps
        for depth in (0, 1):
            x = (1.0 + .06 * depth) * math.cos(theta)
            z = (1.50 + .45 * depth) * math.sin(theta)
            verts.append((x + .12 * depth, depth * 1.17 - .49, z + .002))
    obj = surface('Continuous bent sheet / graphite', verts,
                  [(2*i, 2*i+2, 2*i+3, 2*i+1) for i in range(steps)], material, .036, True)
    obj.location = (1.64, .27, 0)
    obj.rotation_euler.z = -.23
    return obj


def ribbon(material):
    # Each change in direction is a physical fold in one broad strip of cover paper.
    path = [(-1.28,.035), (-.74,.035), (-.25,.43), (.34,.095), (.80,.26), (1.29,.04)]
    verts = [(x + .10*d, d*.52-.26, z) for x,z in path for d in (0,1)]
    obj = surface('Five folded planes / magenta', verts,
                  [(2*i, 2*i+2, 2*i+3, 2*i+1) for i in range(len(path)-1)], material, .025)
    obj.location = (.23, -.86, 0)
    obj.rotation_euler.z = -.24
    return obj


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def area(name, location, target, energy, size, color):
    lamp = bpy.data.lights.new(name, 'AREA')
    lamp.energy, lamp.shape, lamp.size, lamp.color = energy, 'DISK', size, color
    obj = bpy.data.objects.new(name, lamp)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    aim(obj, target)
    return obj


def setup():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    # Blender 4.2–4.5 name the engine BLENDER_EEVEE_NEXT; 5.x returned to BLENDER_EEVEE.
    engines = {item.identifier for item in scene.render.bl_rna.properties['engine'].enum_items}
    scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
    scene.eevee.taa_render_samples = 8
    scene.render.resolution_x, scene.render.resolution_y = WIDTH, HEIGHT
    scene.render.resolution_percentage = 100
    scene.render.use_persistent_data = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.image_settings.compression = 12
    scene.render.fps = FPS
    scene.world = bpy.data.worlds.new('Studio fill')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (.79,.82,.89,1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = .38
    scene.view_settings.view_transform = 'AgX'
    floor = paper('Warm neutral sweep', (.53,.485,.447), .89)
    surface('Unbroken studio floor', [(-120,-120,0),(120,-120,0),(120,120,0),(-120,120,0)],
            [(0,1,2,3)], floor, 0)
    fan = folded_fan(paper('Cotton paper', (.90,.87,.79), .78))
    curve = arch(paper('Graphite stock', (.07,.081,.09), .68))
    fold = ribbon(paper('Magenta coated stock', (.71,.012,.215), .59))
    key = area('Moving softbox', (-3.6,-4.8,7.4), (0,0,0), 650, 3.4, (1,.91,.79))
    area('Soft top edge', (2,3.7,6.2), (0,0,.5), 850, 4.5, (.92,.95,1))
    data = bpy.data.cameras.new('Studio camera')
    camera = bpy.data.objects.new('Studio camera',data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    data.type, data.ortho_scale = 'ORTHO', 8.15
    return scene, camera, key, fan, curve, fold


def frame_scene(items, frame):
    scene, camera, key, fan, curve, fold = items
    phase = 2*math.pi*(frame-1)/FRAMES
    travel = (1-math.cos(phase))/2
    fan.value = .12+.82*travel
    curve.rotation_euler.z = -.23+.16*math.sin(phase)
    fold.rotation_euler.z = -.24+.105*math.sin(phase)
    camera.location = (3.9+.67*travel, -10.0, 4.0+.35*math.sin(phase))
    aim(camera,(-.10,-.03,1.0))
    key.location = (-3.6+1.9*travel,-4.8+.78*math.sin(phase),7.4-.7*travel)
    aim(key,(0,0,0))
    return scene


def render(items, frame, path):
    scene = frame_scene(items, frame)
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def main():
    args = argparse.ArgumentParser()
    args.add_argument('--preview',type=Path)
    args.add_argument('--frame',type=int,default=1)
    args.add_argument('--stills',action='store_true')
    options = args.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    items = setup()
    if options.preview:
        render(items, options.frame, options.preview)
        return
    OUTPUT.mkdir(parents=True,exist_ok=True)
    if options.stills:
        items[0].render.resolution_percentage = STILL_SCALE
        with tempfile.TemporaryDirectory(prefix='reyz-paper-still-') as tmp:
            for frame, name in STILLS:
                source = Path(tmp) / f'{frame:04}.png'
                render(items, frame, source)
                subprocess.run(['ffmpeg','-y','-v','error','-i',str(source),'-c:v','libwebp','-quality','88',str(OUTPUT / name)],check=True)
        return
    with tempfile.TemporaryDirectory(prefix='reyz-paper-study-') as tmp:
        directory = Path(tmp)
        for frame in range(1,FRAMES+1):
            render(items, frame, directory / f'{frame:04}.png')
        video = OUTPUT / 'creative-study-v1.mp4'
        poster = OUTPUT / 'creative-study-v1.webp'
        subprocess.run(['ffmpeg','-y','-v','error','-framerate',str(FPS),'-start_number','1','-i',str(directory/'%04d.png'),
                        '-vf','format=yuv444p,hqdn3d=3:2:2:1','-an','-c:v','libx264','-preset','slow','-crf','23','-pix_fmt','yuv420p','-movflags','+faststart',str(video)],check=True)
        subprocess.run(['ffmpeg','-y','-v','error','-i',str(video),'-frames:v','1','-c:v','libwebp','-quality','90',str(poster)],check=True)


if __name__ == '__main__':
    main()
