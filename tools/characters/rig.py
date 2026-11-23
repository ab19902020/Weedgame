"""Blender background script: blender -b -P rig.py -- officer|civilian input.fbx output.glb"""
import bpy, glob, math, sys
import numpy as np
from mathutils import Vector, Quaternion, Matrix
from pathlib import Path

role, source, output = sys.argv[-3:]
cop = role == 'officer'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=source)
mesh = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
mesh.data.transform(mesh.matrix_world)
mesh.parent = None
mesh.matrix_world = Matrix.Identity(4)
bpy.context.view_layer.objects.active = mesh
bpy.ops.object.select_all(action='DESELECT')
mesh.select_set(True)
# Weld exporter triangle seams before reducing the scan.
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=.000005)
bpy.ops.object.mode_set(mode='OBJECT')
mod = mesh.modifiers.new('Mobile silhouette', 'DECIMATE')
mod.ratio = min(1, 10500 / len(mesh.data.polygons))
bpy.ops.object.modifier_apply(modifier=mod.name)
for poly in mesh.data.polygons:
    poly.use_smooth = True
height = 1.80 if cop else 1.70
scale = height / max(v.co.z for v in mesh.data.vertices)
mesh.data.transform(Matrix.Scale(scale, 4))
if not cop:
    # Dress the civilian for street scenes. Keep the supplied face, hair and hands.
    original = len(mesh.data.materials)
    for label, colour in [('Green jersey',(.045,.19,.14)),('Indigo denim',(.035,.065,.12)),('Dark shoes',(.045,.038,.032))]:
        mat = bpy.data.materials.new(label)
        mat.diffuse_color = (*colour,1)
        mat.use_nodes = True
        shader = mat.node_tree.nodes.get('Principled BSDF')
        shader.inputs['Base Color'].default_value = (*colour,1)
        shader.inputs['Roughness'].default_value = .9
        mesh.data.materials.append(mat)
    for poly in mesh.data.polygons:
        x,y,z = poly.center / scale
        arm_region = abs(x) > .12 and z < .68
        collar = .79 + .018*min(1,abs(x)/.09)
        if z < .067:
            poly.material_index = original+2
        elif z < .517 and not arm_region:
            poly.material_index = original+1
        elif z < collar and (not arm_region or z > .665):
            poly.material_index = original
for image in bpy.data.images:
    paths = glob.glob(str(Path(source).parent / '*.fbm' / (image.name + '.*')))
    if paths:
        image.filepath = paths[0]
        image.reload()
arm = bpy.data.armatures.new(role)
rig = bpy.data.objects.new(role + '_rig', arm)
bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
bones = {}
def bone(name, start, end, parent=None):
    a, b = Vector(start)*scale, Vector(end)*scale
    joint = arm.edit_bones.new(name)
    joint.head, joint.tail = a, b
    if parent:
        joint.parent = arm.edit_bones[parent]
    bones[name] = (np.array(a), np.array(b))

hip = .47
bone('Pelvis',(0,.025,hip),(0,.02,.55))
bone('Spine',(0,.02,.55),(0,.015,.68),'Pelvis')
bone('Chest',(0,.015,.68),(0,.015,.80),'Spine')
bone('Neck',(0,.015,.80),(0,.01,.845),'Chest')
bone('Head',(0,.01,.845),(0,0,.98),'Neck')
for s, side in [(1,'L'),(-1,'R')]:
    leg = .083 if cop else .046
    def pt(x,y,z): return (s*x,y,z)
    def limb(name,a,b,parent): bone(name+side,pt(*a),pt(*b),parent)
    shoulder=(.11,.015,.77)
    elbow=(.24,.02,.76) if cop else (.201,.005,.673)
    wrist=(.36,.019,.75) if cop else (.278,-.026,.59)
    tip=(.42,.018,.745) if cop else (.315,-.05,.54)
    limb('Clavicle',(0,.015,.77),shoulder,'Chest')
    limb('Arm',shoulder,elbow,'Clavicle'+side)
    limb('Forearm',elbow,wrist,'Arm'+side)
    limb('Hand',wrist,tip,'Forearm'+side)
    limb('Thigh',(leg,.027,hip),(leg,.025,.25),'Pelvis')
    limb('Shin',(leg,.025,.25),(leg,.045,.065),'Thigh'+side)
    limb('Foot',(leg,.045,.065),(leg,-.045,.028),'Shin'+side)
bpy.ops.object.mode_set(mode='OBJECT')
pos=np.array([list(v.co) for v in mesh.data.vertices])
dist=[]
groups=[]
for name,(a,b) in bones.items():
    direction=b-a
    t=np.clip((pos-a)@direction / (direction@direction),.05,.95)
    d=((pos-a-t[:,None]*direction)**2).sum(axis=1)
    if name.startswith(('Thigh','Shin','Foot')):
        wrong=pos[:,0]*(1 if name.endswith('L') else -1)<0
        d[wrong & (pos[:,2]<.42*scale)]+=1
    dist.append(d)
    groups.append(mesh.vertex_groups.new(name=name))
dist=np.array(dist).T
for i, indices in enumerate(np.argsort(dist,axis=1)[:,:4]):
    w=(dist[i,indices]+(.017*scale)**2)**-2.8
    for j,v in zip(indices,w/w.sum()):
        groups[j].add([i],float(v),'REPLACE')
mesh.parent=rig
mesh.modifiers.new('Skin','ARMATURE').object=rig
# Define rotations around model-space axes, converted into each joint's rest basis.
def rotate(name,rot):
    p=rig.pose.bones[name]
    basis=p.bone.matrix_local.to_quaternion()
    p.rotation_quaternion=basis.inverted()@rot@basis
    p.keyframe_insert(data_path='rotation_quaternion',frame=frame)
def rx(v): return Quaternion((1,0,0),v)
def ry(v): return Quaternion((0,1,0),v)
def rz(v): return Quaternion((0,0,1),v)
scene=bpy.context.scene
scene.render.fps=24
for clip,frames in [('Idle',72),('Walk',26),('Run',18),('Jump',24),('Swim',36),('WeaponHold',60)]:
    rig.animation_data_create()
    action=bpy.data.actions.new(clip)
    rig.animation_data.action=action
    for frame in range(1,frames+2):
        u=(frame-1)/frames
        phase=math.tau*u
        moving=clip in ('Walk','Run')
        run=clip=='Run'
        jump=math.sin(math.pi*u)**2 if clip=='Jump' else 0
        bounce=(.026 if run else .014)*(1-math.cos(2*phase)) if moving else .003*math.sin(phase)
        pelvis=rig.pose.bones['Pelvis']
        lift=.42*jump if clip=='Jump' else bounce
        pelvis.location=pelvis.bone.matrix_local.to_quaternion().inverted()@Vector((0,0,lift))
        pelvis.keyframe_insert(data_path='location',frame=frame)
        rotate('Pelvis',rz(.045*math.sin(phase) if moving else 0))
        rotate('Chest',rx((.13 if run else .04) if moving else .025*math.sin(phase))@rz(-.10*math.sin(phase) if moving else 0))
        for s,side in [(1,'L'),(-1,'R')]:
            p=phase+(0 if s==1 else math.pi)
            swing=math.cos(p)
            thigh=-(.83 if run else .49)*swing if moving else -.52*jump
            knee=(.15+(.99 if run else .55)*max(0,-math.sin(p))) if moving else .75*jump
            armSwing=(.75 if run else .43)*swing if moving else -.5*jump
            elbow=-(.95 if run else .22) if moving else -.13
            spread=(1.40 if cop else .68)*s
            if clip=='Swim':
                armSwing=-phase+(0 if s==1 else math.pi)
                spread*=.79
                elbow=-.45-.42*math.sin(p)
                thigh=.22*swing
                knee=.20+.14*math.sin(p)
            if clip=='WeaponHold':
                armSwing=-.84 if s==-1 else -.55
                elbow=-.72 if s==-1 else -.46
            rotate('Thigh'+side,rx(thigh))
            rotate('Shin'+side,rx(knee))
            rotate('Foot'+side,rx(-.40*knee))
            upper=rx(armSwing)@ry(spread)
            rotate('Arm'+side,upper)
            rotate('Forearm'+side,upper.inverted()@rx(elbow)@upper)
    rig.animation_data.action=None
    track=rig.animation_data.nla_tracks.new()
    track.name=clip
    track.strips.new(clip,1,action)
    track.mute=True
bpy.ops.object.select_all(action='DESELECT')
mesh.select_set(True)
rig.select_set(True)
bpy.ops.export_scene.gltf(filepath=output,use_selection=True,export_animation_mode='ACTIONS',export_force_sampling=True,export_yup=True)
