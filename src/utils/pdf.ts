import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

export async function downloadInvoicePdf(element: HTMLElement, filename = 'invoice.pdf'){
  const canvas = await html2canvas(element)
  const imgData = canvas.toDataURL('image/png')
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  const imgProps = pdf.getImageProperties(imgData)
  const pdfWidth = pdf.internal.pageSize.getWidth()
  const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width
  pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight)
  pdf.save(filename)
}

export async function shareOrderSummaryImage(element: HTMLElement, filename = 'order-summary.png'): Promise<void> {
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff',
  })

  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) { reject(new Error('Image generation failed')); return }

      const file = new File([blob], filename, { type: 'image/png' })

      // Try Web Share API (native mobile share sheet — WhatsApp, etc.)
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Order Summary' })
          resolve()
          return
        } catch (err: any) {
          // User cancelled share — not an error
          if (err?.name === 'AbortError') { resolve(); return }
        }
      }

      // Fallback: trigger file download to device gallery
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      resolve()
    }, 'image/png')
  })
}
