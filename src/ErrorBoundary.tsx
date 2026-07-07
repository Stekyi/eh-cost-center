import React from 'react'

type State = { error: Error | null }

export default class ErrorBoundary extends React.Component<React.PropsWithChildren<{}>, State> {
  constructor(props: any){
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error: Error){
    return { error }
  }
  componentDidCatch(error: Error, info: any){
    // log to console for dev
    console.error('ErrorBoundary caught', error, info)
  }
  render(){
    if(this.state.error){
      return (
        <div style={{ padding: 24 }}>
          <h2>Application Error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', color: 'red' }}>{this.state.error?.stack || String(this.state.error)}</pre>
        </div>
      )
    }
    return this.props.children as any
  }
}
