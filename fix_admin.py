path = r'C:\Users\Administrator\Desktop\attendance-dashboard\src\components\AdminPage.tsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()
start = content.find('  async function handleEdit')
ret_start = content.find('  return (')
if start > ret_start:
    end = content.find('  const visibleUsers', start)
    if end == -1: end = ret_start
    block = content[start:end]
    new_content = content[:ret_start] + block + '\n\n' + content[ret_start:end] + content[end:]
    with open(path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print('fixed: moved handleEdit inside component')
else:
    print('already inside')
