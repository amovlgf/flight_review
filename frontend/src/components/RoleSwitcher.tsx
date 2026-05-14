export type RoleOption = {
  value: string
  label: string
}

type RoleSwitcherProps = {
  value: string
  options: RoleOption[]
  onChange: (role: string) => void
}

function RoleSwitcher({ value, options, onChange }: RoleSwitcherProps) {
  return (
    <select
      className="select role-select"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((role) => (
        <option key={role.value} value={role.value}>
          {role.label}
        </option>
      ))}
    </select>
  )
}

export default RoleSwitcher
