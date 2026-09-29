path = r'C:\Users\Administrator\Desktop\attendance-dashboard\src\components\UnitsPage.tsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()
# Add reset after download completes
old = "      setRepMsg('Report downloaded');\n    } finally {"
new = "      setRepMsg('Report downloaded');\n      setRepCustom(false);\n      setRepFrom('');\n      setRepTo('');\n    } finally {"
content = content.replace(old, new)
with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('done')
