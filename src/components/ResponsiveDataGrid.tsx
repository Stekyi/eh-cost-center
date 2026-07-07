import * as React from 'react'
import { Box, useMediaQuery, IconButton, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import {
  DataGrid,
  type GridColDef,
  type GridRowId,
  type GridRowParams,
  GridRow,
} from '@mui/x-data-grid'

export type CardField<Row> = {
  label: string
  value: (row: Row) => React.ReactNode
}

type ResponsiveDataGridProps<Row extends { id: GridRowId }> = {
  rows: Row[]
  columns: GridColDef<Row>[]
  cardTitle: (row: Row) => React.ReactNode
  cardFields: Array<CardField<Row>>
  cardActions?: (row: Row) => React.ReactNode
  onRowOpen?: (row: Row) => void
  gridHeight?: number
  highlightRowId?: GridRowId | null
  getExpandedContent?: (row: Row) => React.ReactNode
  processRowUpdate?: (newRow: Row, oldRow: Row) => Promise<Row> | Row
  onProcessRowUpdateError?: (error: any) => void
}

export default function ResponsiveDataGrid<Row extends { id: GridRowId }>(
  props: ResponsiveDataGridProps<Row>
) {
  const { rows, columns, cardTitle, cardFields, cardActions, onRowOpen, gridHeight, highlightRowId, getExpandedContent, processRowUpdate, onProcessRowUpdateError } = props
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))
  const [expandedRows, setExpandedRows] = React.useState<Set<GridRowId>>(new Set())

  const toggleExpanded = (id: GridRowId) => {
    setExpandedRows(prev => {
      const newSet = new Set(prev)
      if (newSet.has(id)) {
        newSet.delete(id)
      } else {
        newSet.add(id)
      }
      return newSet
    })
  }

  // Create expand column for DataGrid
  const expandColumn: GridColDef<Row> = {
    field: 'expand',
    headerName: '',
    width: 50,
    sortable: false,
    filterable: false,
    disableColumnMenu: true,
    renderCell: (params) => {
      const isExpanded = expandedRows.has(params.id)
      return getExpandedContent ? (
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation()
            toggleExpanded(params.id)
          }}
        >
          {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        </IconButton>
      ) : null
    },
  }

  const dataGridColumns = getExpandedContent ? [expandColumn, ...columns] : columns

  if (isMobile) {
    return (
      <Box sx={{ display: 'grid', gap: 1.5 }}>
        {rows.map((row) => {
          const isExpanded = expandedRows.has(row.id)
          return (
            <Box key={String(row.id)}>
              <Box
                className={"card" + (String(row.id) === String(highlightRowId) ? ' row-highlight' : '')}
                sx={{
                  cursor: onRowOpen ? 'pointer' : 'default',
                  p: 2,
                }}
                onClick={() => onRowOpen?.(row)}
              >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Box sx={{ fontWeight: 700 }}>{cardTitle(row)}</Box>
                  {getExpandedContent && (
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleExpanded(row.id)
                      }}
                    >
                      {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                    </IconButton>
                  )}
                </Box>
                <Box sx={{ display: 'grid', gap: 0.5 }}>
                  {cardFields.map((f) => (
                    <Box key={f.label} sx={{ display: 'flex', gap: 1 }}>
                      <Box sx={{ width: 110, color: 'text.secondary', fontSize: 12, flexShrink: 0 }}>
                        {f.label}
                      </Box>
                      <Box sx={{ minWidth: 0 }}>{f.value(row)}</Box>
                    </Box>
                  ))}
                </Box>
                {cardActions ? <Box sx={{ mt: 1.5 }}>{cardActions(row)}</Box> : null}
              </Box>
              {isExpanded && getExpandedContent && (
                <Box sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider' }}>
                  {getExpandedContent(row)}
                </Box>
              )}
            </Box>
          )
        })}
      </Box>
    )
  }

  // Custom row renderer for desktop DataGrid with expansion
  const CustomRow = (props: any) => {
    const { row, index } = props
    const isExpanded = expandedRows.has(row.id)

    return (
      <React.Fragment>
        <GridRow {...props} />
        {isExpanded && getExpandedContent && (
          <TableRow>
            <TableCell colSpan={dataGridColumns.length} sx={{ p: 0 }}>
              <Box sx={{ p: 2, bgcolor: 'grey.50' }}>
                {getExpandedContent(row)}
              </Box>
            </TableCell>
          </TableRow>
        )}
      </React.Fragment>
    )
  }

  return (
    <Box sx={{ width: '100%', maxWidth: '100%', minWidth: 0, height: gridHeight ?? 560 }}>
      <DataGrid
        rows={rows}
        columns={dataGridColumns}
        disableRowSelectionOnClick
        pageSizeOptions={[10, 25, 50, 100]}
        initialState={{
          pagination: { paginationModel: { pageSize: 25, page: 0 } },
        }}
        density="compact"
        onRowClick={(params: GridRowParams<Row>) => onRowOpen?.(params.row)}
        processRowUpdate={processRowUpdate}
        onProcessRowUpdateError={onProcessRowUpdateError}
        slots={{
          row: CustomRow,
        }}
        sx={{
          border: 'none',
          width: '100%',
          maxWidth: '100%',
          minWidth: 0,
          '& .MuiDataGrid-cell:focus, & .MuiDataGrid-columnHeader:focus': { outline: 'none' },
        }}
        getRowClassName={(params) => String(params.id) === String(highlightRowId) ? 'row-highlight' : ''}
      />
    </Box>
  )
}
