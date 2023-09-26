export function mapResultSet(rs) {
  return rs.rows.map((row) => {
    const obj = {}

    rs.columns.forEach((name, i) => {
      obj[name] = row[i]
    })

    return obj
  })
}
