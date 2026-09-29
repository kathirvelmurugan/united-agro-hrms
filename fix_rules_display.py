path = r'C:\Users\Administrator\Desktop\attendance-dashboard\src\components\AllBranchesPage.tsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()
old = '<button onClick={() => deleteRule(r.id)} className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50" title="Delete holiday"><Trash2 size={14} /></button>'
new = '<span className="text-[10px] text-gray-500 font-medium">Branch: {branches.find(b => b.device_id === r.device_id)?.name || "All"}</span><button onClick={() => { setDate(r.date || \'\'); setName(r.name || \'\'); }} className="p-1 rounded text-xs font-medium text-blue-600 hover:text-blue-800" title="Edit">Edit</button><button onClick={() => deleteRule(r.id)} className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50" title="Delete holiday"><Trash2 size={14} /></button>'
content = content.replace(old, new)
content = content.replace('<div className="px-4 py-2.5 border-t border-gray-100 text-[10px] text-gray-400 bg-gray-50/60">Weekly-off &amp; holiday days are excluded from absence. Permission days grant hours to every employee.</div>', '')
with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('updated')
