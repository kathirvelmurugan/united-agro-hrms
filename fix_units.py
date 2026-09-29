path = r'C:\Users\Administrator\Desktop\attendance-dashboard\src\components\UnitsPage.tsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()
content = content.replace('async function downloadReport(branchName: string, deviceId: number, fromMonth?: string, toMonth?: string) {', 'async function downloadReport(branchName: string, deviceId: number, fromMonth?: string) {')
with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('fixed')
