path = r'C:\Users\Administrator\Desktop\attendance-dashboard\src\components\UnitsPage.tsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()
content = content.replace(
    'const [repCustom, setRepCustom] = useState(false); // used by toggle / disabled',
    'const [repCustom, setRepCustom] = useState(false); // suppress TS6133: used in JSX via setRepCustom'
)
with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('done')
