path = r'C:\Users\Administrator\Desktop\attendance-dashboard\src\components\AllBranchesPage.tsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()
content = content.replace('  );\n}\n\n\ninterface CalendarModalProps', '  );\n}\n\ninterface CalendarModalProps')
with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('patched')
