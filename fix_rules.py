path = r'C:\Users\Administrator\Desktop\attendance-dashboard\src\components\AllBranchesPage.tsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()
old = '<div key={r.id} className="flex items-center gap-3 px-4 py-2.5">\n                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-indigo-50 text-indigo-700">Holiday</span>\n                  <div className="min-w-0 flex-1">'
new = '<div key={r.id} className="flex items-center gap-3 px-4 py-2.5">\n                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-indigo-50 text-indigo-700">Holiday</span>\n                  <span className="text-[10px] text-gray-500 font-medium truncate">{branches.find(b => b.device_id === r.device_id)?.name || "All"}</span>\n                  <div className="min-w-0 flex-1">'
content = content.replace(old, new)
old_btn = '<button onClick={() => deleteRule(r.id)} className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50" title="Delete holiday">'
new_btn = '<button onClick={() => { setDate(r.date || \'\'); setName(r.name || \'\'); }} className="p-1 rounded text-xs font-medium text-blue-600 hover:text-blue-800" title="Edit">Edit</button><button onClick={() => deleteRule(r.id)} className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50" title="Delete holiday">'
content = content.replace(old_btn, new_btn)
with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('rules updated')
