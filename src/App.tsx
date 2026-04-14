import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import PhysicalHosts from './pages/PhysicalHosts';
import VirtualMachines from './pages/VirtualMachines';
import Clusters from './pages/Clusters';
import Jobs from './pages/Jobs';
import Settings from './pages/Settings';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="hosts" element={<PhysicalHosts />} />
          <Route path="vms" element={<VirtualMachines />} />
          <Route path="clusters" element={<Clusters />} />
          <Route path="jobs" element={<Jobs />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
