path = r'C:\Users\Administrator\Desktop\attendance-dashboard\src\components\UnitsPage.tsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()
# Add custom range state
content = content.replace(
    'const [repMonths, setRepMonths] = useState<string[]>([]);',
    'const [repMonths, setRepMonths] = useState<string[]>([]);\n  const [repCustom, setRepCustom] = useState(false);\n  const [repFrom, setRepFrom] = useState("");\n  const [repTo, setTo] = useState("");'
)
# Update downloadReport to accept range override
old = '  async function downloadReport(branchName: string, deviceId: number) {\n    if (!data || !repMonth) return;'
new = '  async function downloadReport(branchName: string, deviceId: number, fromMonth?: string, toMonth?: string) {\n    if (!data) return;\n    const monthVal = repCustom ? (fromMonth || repFrom) : repMonth;\n    if (!monthVal) return;'
content = content.replace(old, new)
# Use monthVal in fetchSummary call inside downloadReport - replace repMonth usage with dynamic
content = content.replace(
    "const s = d.months.find((m: { month: string }) => m.month === repMonth) ?? null;",
    "const monthFilter = fromMonth || repMonth;\n          const s = d.months.find((m: { month: string }) => m.month === monthFilter) ?? null;"
)
# Update button disabled and call
content = content.replace(
    'disabled={repLoading || !repMonth}',
    'disabled={repLoading || (!repCustom && !repMonth) || (repCustom && (!repFrom || !repTo))}'
)
# Add Custom Dates toggle button before existing button / replace select area
old_sel = '<button\n                  onClick={() => downloadReport(sel.name, sel.device_id)}\n                  disabled={repLoading || !repMonth}>'
new_sel = '<button onClick={() => setRepCustom(!repCustom)} className="text-[10px] font-semibold text-brand-600 hover:text-blue-700 underline">Custom Dates</button>\n                {repCustom ? (\n                  <div className="flex gap-2">\n                    <input type="date" value={repFrom} onChange={e => setRepFrom(e.target.value)} className="h-8 px-2 rounded-lg border text-xs" />\n                    <input type="date" value={repTo} onChange={e => setRepTo(e.target.value)} className="h-8 px-2 rounded-lg border text-xs" />\n                  </div>\n                ) : (\n                  <select value={repMonth} onChange={e => setRepMonth(e.target.value)} className="h-8 px-2 rounded-lg border border-gray-200 text-[11px] text-gray-700 focus:outline-none">\n                    {repMonths.map(m => <option key={m} value={m}>{m}</option>)}\n                  </select>\n                )}\n                <button\n                  onClick={() => downloadReport(sel.name, sel.device_id, repCustom ? repFrom : undefined, repCustom ? repTo : undefined)}\n                  disabled={repLoading || (!repCustom && !repMonth) || (repCustom && (!repFrom || !repTo))}'
content = content.replace(old_sel, new_sel)
with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('done')
