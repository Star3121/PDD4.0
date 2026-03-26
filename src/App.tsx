import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import OrderList from './pages/OrderList';
import CreateOrder from './pages/CreateOrder';
import DesignEditor from './pages/DesignEditor';
import DesignPreview from './pages/DesignPreview';
import TemplateLibraryPage from './pages/TemplateLibraryPage';
import TemplateDesignEditor from './pages/TemplateDesignEditor';

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-50">
        <Routes>
          <Route path="/" element={<OrderList />} />
          <Route path="/orders/new" element={<CreateOrder />} />
          <Route path="/design/:orderId" element={<DesignEditor />} />
          <Route path="/preview/:orderId" element={<DesignPreview />} />
          <Route path="/templates" element={<TemplateLibraryPage />} />
          <Route path="/template-design" element={<TemplateDesignEditor />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
